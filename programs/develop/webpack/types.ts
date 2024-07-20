import { type LoaderContext as WebpackLoaderContext } from 'webpack';

export interface DevOptions {
  mode?: 'development' | 'production' | 'none' | undefined;
  browser?: 'chrome' | 'edge' | 'firefox' | 'all';
  port?: number;
  noOpen?: boolean;
  preferences?: string;
  profile?: string;
  polyfill?: boolean;
  autoReload?: boolean;
  stats?: boolean;
  startingUrl?: string;
  browserFlags?: string[];
  // Deprecated. Use "profile" instead
  userDataDir?: string;
}

export interface BuildOptions {
  browser?: 'chrome' | 'edge' | 'firefox' | 'all';
  zipFilename?: string;
  zip?: boolean;
  zipSource?: boolean;
  polyfill?: boolean;
}

export interface StartOptions {
  mode?: 'development' | 'production';
  browser?: 'chrome' | 'edge' | 'firefox' | 'all';
  port?: number;
  noOpen?: boolean;
  preferences?: string;
  profile?: string;
  // Deprecated. Use "profile" instead
  userDataDir?: string | boolean;
  polyfill?: boolean;
}

export interface PreviewOptions {
  mode?: 'development' | 'production';
  browser?: 'chrome' | 'edge' | 'firefox' | 'all';
  port?: number;
  noOpen?: boolean;
  preferences?: string;
  profile?: string;
  // Deprecated. Use "profile" instead
  userDataDir?: string | boolean;
  polyfill?: boolean;
}

export type ChromeManifest = Partial<chrome.runtime.ManifestV2> &
  Partial<chrome.runtime.ManifestV3> & {
    browser_action?: {
      theme_icons?: ThemeIcon[];
    };
  };

export type Manifest = ChromeManifest;

export interface ThemeIcon {
  light: string;
  dark: string;
  size?: number;
}

export type PluginInterface = {
  manifestPath: string;
  browser?: string;
  includeList?: FilepathList;
  excludeList?: FilepathList;
};

export interface LoaderInterface extends WebpackLoaderContext<LoaderInterface> {
  manifestPath: string;
  includeList?: FilepathList;
  excludeList?: FilepathList;
}

export type FilepathList = Record<string, string | string[] | undefined>;

export type ResourceType =
  | 'script'
  | 'css'
  | 'html'
  | 'static'
  | 'staticSrc'
  | 'staticHref'
  | 'empty';

export interface OutputPath {
  background?: string;
  contentScripts?: string;
  action?: string;
  icons?: string;
  actionIcon?: string;
  preferencesIcon?: string;
  sidebarIcon?: string;
  newtab?: string;
  history?: string;
  bookmarks?: string;
  devtools?: string;
  options?: string;
  webResources?: string;
  sandbox?: string;
  sidebar?: string;
  preferences?: string;
  userScripts?: string;
  declarativeNetRequest?: string;
  storage?: string;
  sidePanel?: string;
}

export type HtmlFilepathList = Record<
  string,
  | {
      html: string;
      js: string[];
      css: string[];
      static: string[];
    }
  | undefined
>;

export interface LoaderContext {
  resourcePath: string;
  emitFile: (name: string, content: string) => void;
  getOptions: () => {
    test: string;
    manifestPath: string;
    includeList?: FilepathList;
    excludeList?: FilepathList;
  };
}
