import 'react-native';
declare module 'react-native' {
  interface ViewProps {
    /** React Native Web data attributes; ignored on native surfaces. */
    dataSet?: Record<string, string>;
  }
}
