/** DOČASNÉ: skutečné napojení na Gemini se doplňuje. */
import { ChybaModelu, type ModelKlient } from './model';

export function modelGemini(_klic: string): ModelKlient {
  throw new ChybaModelu('klic', 'Napojení na Gemini se ještě dokončuje.');
}
