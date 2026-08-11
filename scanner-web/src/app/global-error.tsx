"use client";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="es">
            <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F3F5F1', color: '#0C0E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
                <div style={{ background: '#fff', borderRadius: 24, padding: 32, maxWidth: 520, width: '100%', textAlign: 'center', boxShadow: '0 18px 50px rgba(23,28,20,0.12)' }}>
                    <div style={{ fontSize: 44 }}>⚠️</div>
                    <h1 style={{ fontSize: 18, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Algo salió mal</h1>
                    <p style={{ fontSize: 13, color: '#5E635C' }}>Ocurrió un error inesperado. Tus datos están a salvo en el servidor.</p>
                    <pre style={{ background: '#F5F7F3', border: '1px solid #E1E5DD', borderRadius: 12, padding: 14, fontSize: 11, color: '#b91c1c', textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflow: 'auto' }}>
                        {error?.message || 'Error desconocido'}{error?.digest ? `\ndigest: ${error.digest}` : ''}
                    </pre>
                    <p style={{ fontSize: 11, color: '#8C928A' }}>Toma un pantallazo de este mensaje y envíalo para diagnosticarlo.</p>
                    <button onClick={() => reset()} style={{ background: '#3A52DA', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 12, cursor: 'pointer' }}>
                        Reintentar
                    </button>
                </div>
            </body>
        </html>
    );
}
