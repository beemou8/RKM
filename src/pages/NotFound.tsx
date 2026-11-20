import { Link } from 'react-router-dom';
import { AlertCircle, Home } from 'lucide-react';
import { Button, Card } from '../components/ui';

export default function NotFound({ forbidden }: { forbidden?: boolean }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="max-w-md w-full p-6 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-rose-500/10 flex items-center justify-center text-rose-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {forbidden ? '403 - Akses Ditolak' : '404 - Halaman Tidak Ditemukan'}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {forbidden
              ? 'Anda tidak memiliki hak akses untuk membuka halaman ini.'
              : 'Halaman yang Anda cari tidak tersedia atau telah dipindahkan.'}
          </p>
        </div>
        <Link to="/" className="inline-block">
          <Button variant="primary">
            <Home className="w-3.5 h-3.5" /> Kembali ke Dashboard
          </Button>
        </Link>
      </Card>
    </div>
  );
}
