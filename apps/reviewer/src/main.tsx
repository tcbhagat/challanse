import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import GuestApp from './GuestApp';
import './styles.css';

const isGuest = window.location.hostname.startsWith('guest.');
createRoot(document.getElementById('root')!).render(<StrictMode>{isGuest ? <GuestApp /> : <App />}</StrictMode>);
