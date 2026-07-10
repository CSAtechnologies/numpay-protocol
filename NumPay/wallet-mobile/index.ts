// Polyfills + core env injection MUST come before anything that (transitively)
// imports @numpay/core. See polyfills.ts. Platform init (MMKV storage into
// core) comes right after, before App pulls in anything that reads storage.
import './polyfills';
import './src/platform/init';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
