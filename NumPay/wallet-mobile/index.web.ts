// UI workbench only. The native entry retains its vault/platform initialization.
import '@expo/metro-runtime';
import { registerRootComponent } from 'expo';
import PreviewWorkbench from './src/preview/PreviewWorkbench';

registerRootComponent(PreviewWorkbench);
