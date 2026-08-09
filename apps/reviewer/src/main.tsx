import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import GuestApp from './GuestApp';
import './styles.css';

const isGuest = window.location.hostname.startsWith('guest.')
  || (import.meta.env.DEV && new URLSearchParams(window.location.search).get('surface') === 'guest');
if (isGuest) document.title = 'ChallanSe Private Invoice';
createRoot(document.getElementById('root')!).render(<StrictMode>{isGuest ? <GuestApp /> : <App />}</StrictMode>);
