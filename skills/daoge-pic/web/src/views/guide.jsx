import { LearningCenter } from '../learning-center.jsx';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function GuideView({ dismissGuide, navigateRoute, view }) {
  return <><LearningCenter onDismiss={dismissGuide} onNavigate={(nextView) => navigateRoute({ view: nextView })} /></>;
}
