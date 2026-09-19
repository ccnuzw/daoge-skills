import { uniqueList } from './app/creation-model.mjs';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { LocalStudioAuthorizationGate, WorkbenchErrorBoundary } from './app/workbench-app.jsx';

/** 窗口标题的基准值。取一次存下来——否则带着计数的标题会被下一次拼装再套一层「(2) (1) …」。 */

/**
 * 顶层横幅要展示的错误：可以是一句给人看的话，也可以是带分类与重试信息的结构化错误。
 * @typedef {string | Error} WorkbenchErrorState
 */

function renderWorkbench() {
  createRoot(document.getElementById('root')).render(<WorkbenchErrorBoundary><LocalStudioAuthorizationGate /></WorkbenchErrorBoundary>);
}

renderWorkbench();
