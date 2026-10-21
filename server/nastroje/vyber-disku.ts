import type { Request } from 'express';
import { rezim } from '../rezim';
import { ChybaDisku, diskGoogle, type DiskKlient } from './disk';
import { diskMock } from './disk-mock';

/** Disk pro tento dotaz: náhrada (MOCK_DISK=1), Google Disk s tokenem z prohlížeče, nebo „nepřipojený". */
export function diskZPozadavku(req: Request): { disk: DiskKlient; poznamka?: string } {
  if (rezim.mockDisk) return { disk: diskMock() };
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (token) return { disk: diskGoogle(token) };
  return {
    disk: diskNepripojeny(),
    poznamka: 'Google Disk není připojený – hledám jen ve smlouvě a na internetu.',
  };
}

function diskNepripojeny(): DiskKlient {
  const chyba = () => {
    throw new ChybaDisku('Google Disk není připojený (uživatel není přihlášen).', 'jina');
  };
  return { hledat: chyba, precist: chyba, najdiPodpis: chyba, stahniObrazek: chyba };
}
