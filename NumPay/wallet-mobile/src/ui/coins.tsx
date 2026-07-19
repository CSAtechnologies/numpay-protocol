// RN port of the extension's icon house framing (Icons.tsx: FramedCoin /
// ChainIcon / AssetIcon / ChainBadge / TokenIcon). Resolution order and the
// deterministic fallback coin come from @numpay/core/icons/urls so a given
// ticker or chain gets the exact same logo (or the same disc colour + label)
// on the phone as in the popup. Platform difference: the drawn SVG glyph art
// can't render without react-native-svg, so the fallback is the spec's disc +
// text label; the disc colour and monogram still match the extension's.
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type ViewStyle } from "react-native";
import {
  tokenIconUrl, chainIconUrl, chainLogoLocal, ETH_L2_CHAINS,
  tokenFallbackSpec, chainFallbackSpec, fontSizeFor, type FallbackCoinSpec,
} from "@numpay/core/icons/urls";
import { NETWORKS } from "@numpay/core/networks";
import { getTokenLogo } from "@numpay/core/logoCache";
import { colors } from "./theme";

// Module-level memo of logo URLs that have failed to load, shared across every
// coin instance, so identical inputs converge on the same source (same reason
// as the extension: uniform badges).
const failedLogoUrls = new Set<string>();

function firstViableIdx(srcs: string[]): number {
  for (let i = 0; i < srcs.length; i++) if (!failedLogoUrls.has(srcs[i])) return i;
  return srcs.length;
}

function FallbackCoin({ spec, size }: { spec: FallbackCoinSpec; size: number }) {
  return (
    <View
      style={[
        st.coin,
        {
          width: size, height: size, backgroundColor: spec.disc,
          alignItems: "center", justifyContent: "center",
        },
        spec.needsRing && { borderWidth: 1, borderColor: colors.coinRing },
      ]}
    >
      <Text
        style={{
          color: spec.textColor,
          fontWeight: "600",
          // fontSizeFor targets the 128px SVG viewBox; scale to the disc.
          fontSize: (fontSizeFor(spec.label) * size) / 128,
        }}
        numberOfLines={1}
      >
        {spec.label}
      </Text>
    </View>
  );
}

// ── FramedCoin — house disc + ring, walks candidate logo URLs then the disc ──
function FramedCoin({
  sources, spec, size,
}: { sources: string[]; spec: FallbackCoinSpec; size: number }) {
  const srcs = sources.filter((s) => s && /^https?:/.test(s));
  const listKey = srcs.join("|");
  const [idx, setIdx] = useState(() => firstViableIdx(srcs));
  useEffect(() => { setIdx(firstViableIdx(srcs)); }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (idx >= srcs.length) return <FallbackCoin spec={spec} size={size} />;
  return (
    <View style={[st.coin, { width: size, height: size, backgroundColor: colors.coinDisc }]}>
      <Image
        source={{ uri: srcs[idx] }}
        style={{ width: "100%", height: "100%" }}
        onError={() => {
          failedLogoUrls.add(srcs[idx]);
          setIdx((cur) => {
            let n = cur + 1;
            while (n < srcs.length && failedLogoUrls.has(srcs[n])) n++;
            return n;
          });
        }}
      />
    </View>
  );
}

// Base rebranded to "The Square" (fill #0000FF); CDNs still serve the old blue
// circle, so — like the extension — render the current mark locally. Without
// SVG support this is a rounded blue square on a white disc, which is exactly
// what the official mark is.
function BaseSquareCoin({ size }: { size: number }) {
  const inner = size * 0.62;
  return (
    <View
      style={[st.coin, {
        width: size, height: size, backgroundColor: "#ffffff",
        alignItems: "center", justifyContent: "center",
      }]}
    >
      <View style={{
        width: inner, height: inner, backgroundColor: "#0000FF",
        borderRadius: Math.max(1.5, inner * 0.09),
      }} />
    </View>
  );
}

// ── ChainIcon — real chain logo (vendored → app → DefiLlama) → drawn disc ────
export function ChainIcon({
  chainId, logo, size = 24,
}: { chainId: string; logo?: string; size?: number }) {
  if (chainId === "base") return <BaseSquareCoin size={size} />;
  const sources = Array.from(new Set(
    [chainLogoLocal(chainId) || "", NETWORKS[chainId]?.logo || "", chainIconUrl(chainId) || "", logo || ""]
      .filter(Boolean),
  ));
  return <FramedCoin sources={sources} spec={chainFallbackSpec(chainId)} size={size} />;
}

// ── TokenIcon — symbol-keyed brand logo, identical for a ticker on any chain ─
export function TokenIcon({
  symbol, logo, tokenAddress, size = 32,
}: { symbol: string; logo?: string; chainId?: string; tokenAddress?: string; size?: number }) {
  const sources = [tokenIconUrl(symbol), logo || "", getTokenLogo(tokenAddress) || ""];
  return <FramedCoin sources={sources} spec={tokenFallbackSpec(symbol)} size={size} />;
}

// ── AssetIcon — the rule for every asset row (same exception as the popup:
// a native coin on an ETH-L2 shows the chain mark instead of the ETH diamond) ─
export function AssetIcon({
  symbol, logo, chainId, address, size = 24,
}: { symbol: string; logo?: string; chainId?: string; address?: string; size?: number }) {
  if (!address && chainId && ETH_L2_CHAINS.has(chainId))
    return <ChainIcon chainId={chainId} logo={logo} size={size} />;
  return <TokenIcon symbol={symbol} logo={logo} chainId={chainId} tokenAddress={address} size={size} />;
}

// ── ChainBadge — small chain mark in the bottom-right corner of a token icon.
// Render inside a `position: relative`-equivalent parent right after the main
// AssetIcon. The ring is a page-coloured border so it stays legible.
export function ChainBadge({
  chainId, logo, size = 14, ringColor = colors.bg,
}: { chainId: string; logo?: string; size?: number; ringColor?: string }) {
  const wrap: ViewStyle = {
    position: "absolute", bottom: -2, right: -2,
    width: size + 3, height: size + 3, borderRadius: (size + 3) / 2,
    borderWidth: 1.5, borderColor: ringColor,
    alignItems: "center", justifyContent: "center", backgroundColor: ringColor,
  };
  return (
    <View style={wrap}>
      <ChainIcon chainId={chainId} logo={logo} size={size} />
    </View>
  );
}

const st = StyleSheet.create({
  coin: {
    borderRadius: 999,
    overflow: "hidden",
    flexShrink: 0,
  },
});
