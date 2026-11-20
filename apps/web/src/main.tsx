import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './styles/base.css';

const element = document.getElementById('root');
if (!element) throw new Error('The application root is missing.');
createRoot(element).render(<StrictMode><App /></StrictMode>);
