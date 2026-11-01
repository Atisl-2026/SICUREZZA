import { render } from 'preact';
import { App } from './app';
import { requestPersistence } from './lib/db';
import { warmUpIndex } from './lib/search';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Riduce il rischio che il browser (in particolare Safari iOS) cancelli i dati locali.
requestPersistence();

// Prepara l'indice di ricerca in background.
warmUpIndex();
