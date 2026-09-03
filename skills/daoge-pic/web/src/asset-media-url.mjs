function assetId(asset) {
  return typeof asset === 'string' ? asset : asset?.id;
}

export function assetOriginalUrl(asset, download = false) {
  const id = assetId(asset);
  if (!id) return '';
  if (download && typeof asset === 'object' && asset.downloadUrl) return asset.downloadUrl;
  return '/api/assets/' + encodeURIComponent(id) + '/file' + (download ? '?download=1' : '');
}

// The API may supply a CDN thumbnail directly; otherwise use the Workbench thumbnail route.
export function assetThumbnailUrl(asset) {
  const id = assetId(asset);
  if (!id) return '';
  return asset?.thumbnailUrl || asset?.urls?.thumbnail || '/api/assets/' + encodeURIComponent(id) + '/thumbnail';
}

export function deliveryThumbnailUrl(deliveryId, sequence, asset = null) {
  return asset?.thumbnailUrl || asset?.urls?.thumbnail || '/api/deliveries/' + encodeURIComponent(deliveryId) + '/files/' + encodeURIComponent(sequence) + '?variant=thumbnail';
}
