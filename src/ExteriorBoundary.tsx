import { Component, type ReactNode } from "react";
export default class ExteriorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="canvas-wrap exterior-wrap">
        <div className="viewer-fallback" role="alert">
          <strong>3D could not load</strong>
          <p>
            Your project and autosave are unaffected. Return to Footprint or
            Interior Planning. After Saved appears, reload the page to retry
            loading the viewer.
          </p>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
