// FASE 1: segnaposto. Elenco record, import/export e aggiornamento remoto arrivano nella fase 2.
export function DatabasePage() {
  return (
    <section>
      <h2>Database</h2>
      <div class="card">
        <p class="muted">Il database locale non contiene ancora record.</p>
        <p class="muted small">Import JSON/CSV, aggiornamento da GitHub, modifica dei record e backup saranno qui.</p>
      </div>
    </section>
  );
}
