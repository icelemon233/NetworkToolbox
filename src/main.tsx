import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './shared/context';
import './styles.css';
import { installInputModality } from './shared/input-modality';
const disposeInputModality = installInputModality();
import.meta.hot?.dispose(disposeInputModality);
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal">
          <h1>界面未能完成加载</h1>
          <p>{this.state.error}</p>
          <button onClick={() => location.reload()}>重新加载</button>
        </div>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <AppProvider>
        <App />
      </AppProvider>
    </Boundary>
  </StrictMode>,
);
