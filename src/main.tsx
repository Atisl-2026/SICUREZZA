import { render } from 'preact';
import { App } from './app';
import { requestPersistence } from './lib/db';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Riduce il rischio che il browser (in particolare Safari iOS) cancelli i dati locali.
requestPersistence();
