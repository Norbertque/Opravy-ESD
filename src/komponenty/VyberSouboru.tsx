import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';

interface Props {
  popisek: string;
  napoveda?: string;
  /** Hodnota pro atribut accept, např. ".pdf,application/pdf" */
  prijima: string;
  vice?: boolean;
  onVybrano: (soubory: File[]) => void;
}

/** Plocha pro výběr souborů kliknutím nebo přetažením. */
export function VyberSouboru({ popisek, napoveda, prijima, vice = false, onVybrano }: Props) {
  const vstup = useRef<HTMLInputElement>(null);
  const [nadPlochou, setNadPlochou] = useState(false);

  const predej = (seznam: FileList | null) => {
    if (!seznam || seznam.length === 0) return;
    const soubory = Array.from(seznam);
    onVybrano(vice ? soubory : soubory.slice(0, 1));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => vstup.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && vstup.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setNadPlochou(true);
      }}
      onDragLeave={() => setNadPlochou(false)}
      onDrop={(e) => {
        e.preventDefault();
        setNadPlochou(false);
        predej(e.dataTransfer.files);
      }}
      className={`flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-3 text-center transition ${
        nadPlochou ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/40'
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-slate-800">
        <Upload size={18} /> {popisek}
      </span>
      {napoveda && <span className="text-sm text-slate-500">{napoveda}</span>}
      <input
        ref={vstup}
        type="file"
        accept={prijima}
        multiple={vice}
        className="hidden"
        onChange={(e) => {
          predej(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
