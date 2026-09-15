// 前端挂在 window 上的全局标记。它们都是「写在这里、由别处读取」的：
// 崩溃现场的详细信息写进 window，Studio 的诊断面板与后台服务日志再从那里取，
// 这样即使 React 已经渲染不出来，用户复制诊断信息时依然能带上原因。
declare global {
  interface Window {
    /** 最近一次渲染崩溃的堆栈或原因，由错误边界写入。 */
    __daogeWorkbenchRenderError?: string;
  }
}

declare module 'react' {
  interface CSSProperties {
    /**
     * React 自带的 style 类型不认识 CSS 自定义属性（--inspector-zoom 这类），
     * 每次用到都要写一次类型断言。这里一次性补齐，写 style 时按普通属性写即可。
     */
    [cssVariable: `--${string}`]: string | number | undefined;
  }
}

export {};
