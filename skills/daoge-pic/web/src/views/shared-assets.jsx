import { SharedAssets } from '../shared-assets.jsx';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function SharedAssetsView({ assets, copyAsset, downloadAsset, navigateRoute, projects, setAssetShared, sharedAssets, view }) {
  return <><SharedAssets assets={sharedAssets} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onOpenProjects={() => navigateRoute({ view: 'projects' })} /></>;
}
