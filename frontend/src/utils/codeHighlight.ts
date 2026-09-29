/**
 * Shared syntax-highlighting setup for CodeBlock and DiffBlock.
 *
 * Uses react-syntax-highlighter's Prism Light build so only the languages we
 * actually emit are bundled. Theme: One Dark (Atom).
 */
import { PrismLight } from 'react-syntax-highlighter';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';

import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import hcl from 'react-syntax-highlighter/dist/esm/languages/prism/hcl';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

PrismLight.registerLanguage('bash', bash);
PrismLight.registerLanguage('sh', bash);
PrismLight.registerLanguage('shell', bash);
PrismLight.registerLanguage('css', css);
PrismLight.registerLanguage('docker', docker);
PrismLight.registerLanguage('dockerfile', docker);
PrismLight.registerLanguage('go', go);
PrismLight.registerLanguage('hcl', hcl);
PrismLight.registerLanguage('terraform', hcl);
PrismLight.registerLanguage('javascript', javascript);
PrismLight.registerLanguage('js', javascript);
PrismLight.registerLanguage('json', json);
PrismLight.registerLanguage('jsx', jsx);
PrismLight.registerLanguage('html', markup);
PrismLight.registerLanguage('xml', markup);
PrismLight.registerLanguage('python', python);
PrismLight.registerLanguage('py', python);
PrismLight.registerLanguage('rust', rust);
PrismLight.registerLanguage('rs', rust);
PrismLight.registerLanguage('sql', sql);
PrismLight.registerLanguage('tsx', tsx);
PrismLight.registerLanguage('typescript', typescript);
PrismLight.registerLanguage('ts', typescript);
PrismLight.registerLanguage('yaml', yaml);
PrismLight.registerLanguage('yml', yaml);

export const codeTheme = oneDark;
export const Highlighter = PrismLight;

// Normalize incoming language strings — Prism is case-sensitive and we want
// lenient aliasing. Falls back to "text" (plain rendering) when unknown.
const KNOWN = new Set([
  'bash', 'sh', 'shell', 'css', 'docker', 'dockerfile', 'go', 'hcl', 'terraform',
  'javascript', 'js', 'json', 'jsx', 'html', 'xml', 'python', 'py', 'rust', 'rs',
  'sql', 'tsx', 'typescript', 'ts', 'yaml', 'yml',
]);

export const normalizeLanguage = (lang?: string): string => {
  const l = (lang || '').toLowerCase().trim();
  if (!l) return 'text';
  return KNOWN.has(l) ? l : 'text';
};
