// Android release-build config plugin.
//
// WHY THIS EXISTS: android/ and ios/ are gitignored as generated folders
// (Expo CNG), so anything hand-edited in android/ is wiped by the next
// `expo prebuild`. Two changes MUST survive that, so they live here instead:
//
//   1. Release signing. Without it a prebuild silently reverts to the debug
//      keystore. Shipping a build on a different key than the last one means
//      Android refuses the in-place upgrade, and the only way forward is
//      uninstall/reinstall, which WIPES THE VAULT. That is a fund-loss bug,
//      not an inconvenience.
//
//   2. The Windows MAX_PATH workaround, without which no arm64 release build
//      completes on this machine at all.
//
// Credentials are never stored here. They are read at build time from
// android/keystore.properties, which is gitignored, and the keystore itself
// lives outside the repo entirely.

const { withProjectBuildGradle, withAppBuildGradle } = require("expo/config-plugins");

const STAGING_MARKER = "// numpay:cmake-staging";
const SIGNING_MARKER = "// numpay:release-signing";

// CMake mangles each object file's ABSOLUTE source path into its FILENAME.
// Under this repo's real path the staging dir is already ~192 chars, and a
// ~130-char mangled name pushes past Windows' 250-char limit. It only bites
// in release: "RelWithDebInfo" is 9 characters longer than "Debug", which is
// the whole difference between a working arm64 debug build and a failing
// release one. Junctions do NOT help, because Expo autolinking resolves
// node_modules through Node's realpath and canonicalizes them away first.
const STAGING_BLOCK = `
${STAGING_MARKER} - see plugins/withAndroidRelease.js
def numpayNativeStagingRoot = System.getenv("NUMPAY_CMAKE_STAGING") ?: "C:/nx"
subprojects { sp ->
  afterEvaluate {
    if (sp.plugins.hasPlugin("com.android.library") || sp.plugins.hasPlugin("com.android.application")) {
      sp.android {
        externalNativeBuild {
          cmake {
            buildStagingDirectory = new File("\${numpayNativeStagingRoot}/\${sp.name}")
          }
        }
      }
    }
  }
}
`;

// Loaded from a gitignored file, and absent on a fresh clone or CI. When it
// is missing we fall back to debug signing so the build still completes
// rather than hard-failing on a machine that has no release key.
// NOTE the "../": the file lives at wallet-mobile/keystore.properties, one
// level ABOVE the generated android/ folder. Putting it inside android/ means
// `expo prebuild --clean` deletes it, and the next release build then quietly
// falls back to debug signing, which is the exact failure this plugin exists
// to prevent.
const SIGNING_LOADER = `
${SIGNING_MARKER} - see plugins/withAndroidRelease.js
def numpayKeystoreFile = rootProject.file("../keystore.properties")
def numpayHasReleaseKey = numpayKeystoreFile.exists()
def numpayKeystore = new Properties()
if (numpayHasReleaseKey) {
    numpayKeystore.load(new FileInputStream(numpayKeystoreFile))
}
`;

const withStagingDir = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("withAndroidRelease: expected a groovy project build.gradle");
    }
    if (cfg.modResults.contents.includes(STAGING_MARKER)) return cfg;
    cfg.modResults.contents = STAGING_BLOCK + "\n" + cfg.modResults.contents;
    return cfg;
  });

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("withAndroidRelease: expected a groovy app build.gradle");
    }
    let src = cfg.modResults.contents;
    if (src.includes(SIGNING_MARKER)) return cfg;

    src = SIGNING_LOADER + "\n" + src;

    // Add a release signingConfig next to the template's debug one.
    const debugSigning = /(signingConfigs\s*\{\s*\n\s*debug\s*\{[^}]*\}\s*\n)/;
    if (!debugSigning.test(src)) {
      throw new Error("withAndroidRelease: could not find the debug signingConfig to anchor to");
    }
    src = src.replace(
      debugSigning,
      `$1        if (numpayHasReleaseKey) {
            release {
                storeFile file(numpayKeystore['NUMPAY_STORE_FILE'])
                storePassword numpayKeystore['NUMPAY_STORE_PASSWORD']
                keyAlias numpayKeystore['NUMPAY_KEY_ALIAS']
                keyPassword numpayKeystore['NUMPAY_KEY_PASSWORD']
            }
        }
`,
    );

    // Point the release buildType at it. The RN template hardcodes
    // `signingConfig signingConfigs.debug` inside buildTypes.release.
    const releaseBuildType = /(release\s*\{\s*\n(?:\s*\/\/[^\n]*\n)*)(\s*)signingConfig signingConfigs\.debug/;
    if (!releaseBuildType.test(src)) {
      throw new Error("withAndroidRelease: could not find buildTypes.release signingConfig");
    }
    src = src.replace(
      releaseBuildType,
      `$1$2signingConfig numpayHasReleaseKey ? signingConfigs.release : signingConfigs.debug`,
    );

    cfg.modResults.contents = src;
    return cfg;
  });

module.exports = (config) => withReleaseSigning(withStagingDir(config));
