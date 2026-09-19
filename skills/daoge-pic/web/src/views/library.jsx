import { CreativeLibrary } from '../creative-library.jsx';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function LibraryView({ assets, brandKits, navigateRoute, projects, sharedAssets, styleKits, taskTypes, view }) {
  return <><CreativeLibrary taskTypes={taskTypes} styleKits={styleKits} brandKits={brandKits} sharedAssets={sharedAssets} onOpenProjects={() => navigateRoute({ view: 'projects' })} onOpenSharedAssets={() => navigateRoute({ view: 'shared-assets' })} /></>;
}
