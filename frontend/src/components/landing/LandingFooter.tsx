import { Separator } from '@/components/ui/Separator';

export function LandingFooter() {
  return (
    <footer className="w-full bg-[#070712] px-6 py-12 lg:px-10 text-center">
      <div className="max-w-[1280px] mx-auto">
        <div className="h-px w-full bg-white/10 mb-8" />
        <div className="flex flex-col items-center gap-6 text-sm text-white/50">
          <div className="flex gap-8">
            <a href="#" className="hover:text-white transition-colors">
              Termos de Uso
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Política de Privacidade
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Cookies
            </a>
          </div>
          <div>
            © {new Date().getFullYear()} Admin Payments. Todos os direitos
            reservados.
          </div>
        </div>
      </div>
    </footer>
  );
}
