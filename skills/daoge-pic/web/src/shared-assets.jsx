import { useState } from 'react';
import { Copy, Download, FolderKanban, Images, Info, Library, Search, Share2, X } from 'lucide-react';
import { assetThumbnailUrl } from './asset-media-url.mjs';
import { PageHeader } from './components/PageHeader.jsx';

export function SharedAssets({ assets, onDownload, onCopy, onSetShared, onOpenProjects }) {
  // 批 D（第 8 批）§7.6：资料三页共用同一个「页内搜索」位——共享素材此前没有，补上。
  const [query, setQuery] = useState('');
  const keyword = query.trim().toLowerCase();
  const visible = keyword ? assets.filter((asset) => (asset.display?.label || '').toLowerCase().includes(keyword) || String(asset.id).toLowerCase().includes(keyword)) : assets;
  return <section className="shared-assets-stage">
    <PageHeader kicker="资料" title="共享素材" description="只显示你明确共享出来、可跨项目复用的图片。"><button type="button" className="outline-button" onClick={onOpenProjects}><FolderKanban size={16} />项目素材</button></PageHeader>

    <div className="shared-assets-filter" data-block="page-filter">
      <label><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按名称或 ID 过滤共享素材" aria-label="过滤共享素材" /></label>
      <span>{keyword ? visible.length + ' / ' + assets.length + ' 张' : assets.length + ' 张已共享'}</span>
    </div>

    <details className="shared-assets-boundary">
      <summary><Info size={16} />共享说明</summary>
      <div><Share2 size={17} /><span>共享是一项明确动作，取消共享不会删除原项目图片。</span></div>
      <div><Library size={17} /><span>引用共享素材时，仍需明确目标项目与用途。</span></div>
    </details>

    {!assets.length ? <section className="shared-assets-empty"><Images size={32} strokeWidth={1.15} /><h3>还没有共享素材</h3><p>需要跨项目复用时，从项目资产的更多操作中选择“共享素材”。</p><button type="button" className="command-button" onClick={onOpenProjects}><FolderKanban size={16} />查看项目素材</button></section>
      : visible.length ? <section className="shared-assets-grid" aria-label="已共享素材">
      {visible.map((asset) => <article key={asset.id}>
        <img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" />
        <div className="shared-asset-info"><span><Images size={14} />已共享</span><b>{asset.display?.label || (asset.kind === 'generated' ? '生成图片' : '导入图片')}</b></div>
        <div className="shared-asset-actions"><button type="button" title="下载原图" aria-label="下载原图" onClick={() => onDownload(asset)}><Download size={16} /></button><button type="button" title="复制图片" aria-label="复制图片" onClick={() => void onCopy(asset)}><Copy size={16} /></button><button type="button" title="取消跨项目共享" aria-label="取消跨项目共享" onClick={() => void onSetShared(asset, false)}><X size={16} /></button></div>
      </article>)}
    </section>
      : <p className="shared-assets-no-match" role="status">没有匹配的共享素材；换个词或清空过滤。</p>}
  </section>;
}
