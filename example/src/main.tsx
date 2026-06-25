import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DialRoot, connectDialKitStudio } from 'dialkit';
import 'dialkit/styles.css';
import { PhotoStack } from './PhotoStack';
import { Release } from './Release';

// No-op unless this prototype is running inside DialKit Studio.
connectDialKitStudio();

// When served under a sub-path (e.g. DialKit Studio's /v/<ref>/), Vite sets
// BASE_URL to that path; using it as the router basename keeps routes working
// both standalone and embedded. Prototypes with client-side routing should do
// the same (or use a hash router).
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<><PhotoStack /><DialRoot position="top-right" /></>} />
        <Route path="/release-1.2" element={<Release />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
