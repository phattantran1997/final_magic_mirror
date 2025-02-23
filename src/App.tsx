// App.tsx
import './App.css';
import WebcamStream from './components/realtime-detector';

function App() {
  return (
    <>
      <div className="fullscreen-container">
        <WebcamStream videoPath='videos_anz' />
      </div>
    </>
  );
}

export default App;
