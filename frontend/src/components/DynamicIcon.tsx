import React from 'react';
import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

// Canonical course-icon categories → kebab-case Lucide icon names.
// The backend constrains the AI to emit ONE of these slugs (see
// COURSE_ICON_CATEGORIES in backend/app/services/generation_service.py), so
// every course resolves to a deliberate, on-brand icon. Keep the two lists in sync.
const CATEGORY_ICONS: Record<string, string> = {
  programming:  'code',
  web:          'globe',
  ai:           'bot',
  data:         'bar-chart-3',
  cloud:        'cloud',
  security:     'shield',
  database:     'database',
  devops:       'server',
  networking:   'network',
  mobile:       'smartphone',
  hardware:     'cpu',
  design:       'palette',
  business:     'briefcase',
  finance:      'trending-up',
  marketing:    'megaphone',
  math:         'sigma',
  science:      'flask-conical',
  health:       'heart-pulse',
  language:     'languages',
  humanities:   'landmark',
  productivity: 'target',
  gaming:       'gamepad-2',
  music:        'music',
  writing:      'pen-tool',
  general:      'book-open',
};

// Legacy fallback: older courses stored a raw emoji in the DB. Map the common
// ones to a Lucide icon so pre-existing courses still render sensibly.
const EMOJI_MAP: Record<string, string> = {
  '🤖': 'bot',
  '☁️': 'cloud',
  '🐳': 'box',
  '🐍': 'terminal',
  '⚙️': 'cpu',
  '⚛️': 'layers',
  '📚': 'book-open',
  '🔐': 'shield',
  '📊': 'bar-chart-2',
  '🌐': 'globe',
  '💻': 'laptop',
  '🚀': 'rocket',
  '🔧': 'wrench',
  '🎯': 'target',
  '💡': 'lightbulb',
  '🧠': 'brain',
  '🔒': 'lock',
  '📱': 'smartphone',
  '🎓': 'graduation-cap',
  '⚡': 'zap',
  '🌟': 'star',
  '🔥': 'flame',
  '🐛': 'bug',
  '📦': 'package',
  '🗄️': 'database',
  '🔗': 'link',
  '🎨': 'palette',
  '🛡️': 'shield',
  '☕': 'coffee',
  '✨': 'sparkles',
  '📝': 'file-text',
  '🏆': 'trophy',
  '🎮': 'gamepad-2',
  '🔬': 'microscope',
  '🧪': 'flask-conical',
  '🖥️': 'monitor',
  '📡': 'radio',
  '🏗️': 'building-2',
  '🌊': 'waves',
  '🔴': 'circle',
  '🟢': 'circle',
  '🔵': 'circle',
  '⭐': 'star',
  '🎉': 'party-popper',
  '👁️': 'eye',
  '🔑': 'key-round',
  '📈': 'trending-up',
  '📉': 'trending-down',
  '🗂️': 'folder',
  '📂': 'folder-open',
  '🖱️': 'mouse-pointer',
  '⌨️': 'keyboard',
  '🌍': 'globe',
  '🌎': 'globe',
  '🌏': 'globe',
};

// Checks if a string starts with or is predominantly an emoji
function startsWithEmoji(s: string): boolean {
  // Unicode emoji ranges — covers most common emoji
  return /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}☀-⛿]/u.test(s);
}

// Converts kebab-case 'book-open' → PascalCase 'BookOpen'
const toPascal = (s: string) =>
  s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');

interface DynamicIconProps extends LucideProps {
  name?: string;
}

const DynamicIcon: React.FC<DynamicIconProps> = ({ name, ...props }) => {
  let iconKey = 'BookOpen';

  if (name) {
    const slug = name.trim().toLowerCase();
    if (CATEGORY_ICONS[slug]) {
      // Canonical category slug (e.g. 'ai', 'science', 'general')
      iconKey = toPascal(CATEGORY_ICONS[slug]);
    } else if (startsWithEmoji(name)) {
      // Legacy: raw emoji stored on older courses → kebab-case name → PascalCase
      const mapped = EMOJI_MAP[name] ?? EMOJI_MAP[name.trim().charAt(0)] ?? 'book-open';
      iconKey = toPascal(mapped);
    } else {
      // Already a kebab-case Lucide name (e.g. 'bot', 'cloud', 'book-open')
      iconKey = toPascal(name);
    }
  }

  const IconComponent =
    (Icons as unknown as Record<string, React.FC<LucideProps>>)[iconKey] ?? Icons.BookOpen;

  return <IconComponent {...props} />;
};

export default DynamicIcon;
