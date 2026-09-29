import React, { useState, useEffect } from 'react';
import { Hand, X, Check, Lightbulb } from 'lucide-react';
import { Flashcard } from '../types';

interface InteractiveFlashcardProps {
  cards: Flashcard[]; // must be non-empty
}

const InteractiveFlashcard: React.FC<InteractiveFlashcardProps> = ({ cards }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [animating, setAnimating] = useState(false);

  const data = cards;
  useEffect(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
  }, [cards]);

  // Circular buffer logic
  const currentCard = data[currentIndex % data.length];
  const nextCard = data[(currentIndex + 1) % data.length];

  const getQuestionSizeClass = (text: string) => {
    if (text.length > 120) return 'text-xl';
    if (text.length > 80) return 'text-2xl';
    return 'text-3xl';
  };

  const getAnswerSizeClass = (text: string) => {
    const len = text.replace(/\n/g, ' ').length;
    if (len > 200) return 'text-base';
    if (len > 150) return 'text-lg';
    if (len > 100) return 'text-xl';
    if (len > 60) return 'text-2xl';
    return 'text-2xl';
  };

  // Render text with \n as proper line breaks or list items
  const renderCardText = (text: string, isAnswer: boolean = false) => {
    if (!text.includes('\n')) return text;
    const lines = text.split('\n').filter(l => l.trim());
    // If all lines start with digit+dot or bullet, render as a list
    const isList = lines.every(l => /^\d+[\.\)]\s|^[•\-]\s/.test(l.trim()));
    if (isList) {
      return (
        <ul className={`text-left space-y-1 w-full ${isAnswer ? '' : ''}`}>
          {lines.map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-indigo-300/70 flex-shrink-0 mt-0.5 text-xs">{i + 1}.</span>
              <span>{line.replace(/^\d+[\.\)]\s*|^[•\-]\s*/, '')}</span>
            </li>
          ))}
        </ul>
      );
    }
    // Otherwise render with line breaks
    return (
      <span>
        {lines.map((line, i) => (
          <span key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </span>
        ))}
      </span>
    );
  };

  const handleSwipe = (direction: 'left' | 'right', e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (animating) return;

    setAnimating(true);
    setSwipeDirection(direction);
    
    // Animate out
    setTimeout(() => {
        setIsFlipped(false);
        setSwipeDirection(null);
        setCurrentIndex((prev) => prev + 1);
        setAnimating(false);
    }, 400); // 400ms match css duration
  };

  const toggleFlip = () => {
    if (!animating) setIsFlipped(!isFlipped);
  };

  // Refs so the keydown listener always sees latest state/handlers
  const animatingRef = React.useRef(animating);
  animatingRef.current = animating;
  const handleSwipeRef = React.useRef(handleSwipe);
  handleSwipeRef.current = handleSwipe;

  // Keyboard shortcuts: Space = flip, ArrowLeft = Hard, ArrowRight = Easy (work when focus is not in an input)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!animatingRef.current) setIsFlipped((prev) => !prev);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSwipeRef.current('left');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSwipeRef.current('right');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative w-full h-[420px] max-w-sm mx-auto perspective-1000 group select-none flex items-center justify-center">
      
      {/* Stack Layer 3 (Deepest) - Messy rotation left */}
      <div className="absolute w-full h-full bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-gray-200 dark:border-slate-700 transform translate-y-6 -translate-x-4 -rotate-6 scale-[0.85] opacity-40 z-0 transition-all duration-500"></div>

      {/* Stack Layer 2 (Middle) - Messy rotation right */}
      <div className="absolute w-full h-full bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-gray-200 dark:border-slate-700 transform translate-y-4 translate-x-3 rotate-3 scale-[0.9] opacity-60 z-0 transition-all duration-500"></div>

      {/* Next Card (Visible behind active) - Slight rotation */}
      <div 
        className={`absolute w-full h-full bg-white dark:bg-slate-800 rounded-3xl shadow-md border border-gray-200 dark:border-slate-700 z-10 flex flex-col items-center justify-center p-8 transition-all duration-500 ease-out ${
            swipeDirection ? 'transform translate-y-0 translate-x-0 rotate-0 scale-100 opacity-100' : 'transform translate-y-2 -translate-x-1 -rotate-2 scale-[0.95] opacity-80'
        }`}
      >
         <span className="text-xs font-bold uppercase tracking-wider text-primary mb-4 opacity-70">Up Next</span>
         <div className="w-16 h-1 bg-gray-100 dark:bg-slate-700 rounded-full mb-6"></div>
         <h4 className="text-xl font-display font-bold text-text-light dark:text-text-dark text-center opacity-40 blur-[1px]">
            {nextCard.front}
         </h4>
         <div className="w-24 h-1 bg-gray-100 dark:bg-slate-700 rounded-full mt-6"></div>
      </div>

      {/* Main Active Card (Card 1) */}
      <div 
        className={`relative w-full h-full transition-all duration-500 preserve-3d cursor-pointer z-20 
            ${isFlipped ? 'rotate-y-180' : ''} 
            ${swipeDirection === 'left' ? '-translate-x-[150%] -rotate-12 opacity-0' : ''} 
            ${swipeDirection === 'right' ? 'translate-x-[150%] rotate-12 opacity-0' : ''}
            ${!swipeDirection && !isFlipped ? 'hover:-translate-y-2 hover:rotate-1 hover:shadow-2xl' : ''}
        `}
        onClick={toggleFlip}
      >
        
        {/* Front Side */}
        <div className="absolute inset-0 w-full h-full bg-white dark:bg-slate-800 rounded-3xl shadow-card border border-gray-200 dark:border-slate-700 backface-hidden overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50">
            <span className="text-xs font-bold uppercase tracking-wider text-primary bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded">
                {currentCard.category}
            </span>
            <span className="text-xs text-text-muted font-medium">Card {(currentIndex % data.length) + 1}</span>
          </div>
          
          {/* Content */}
          <div className="flex-1 p-8 flex flex-col justify-center items-center text-center relative">
            <h4 className={`${getQuestionSizeClass(currentCard.front)} font-display font-bold text-text-light dark:text-text-dark leading-snug text-center`}>
              {currentCard.front}
            </h4>
            
            <div className="mt-8 text-xs font-bold text-text-muted uppercase tracking-widest flex items-center opacity-50 animate-pulse">
              <Hand size={16} className="mr-1" />
              Tap to Flip
            </div>
          </div>

          {/* Interactive Hover Zones (Invisible but clickable) */}
          <div className="absolute inset-0 flex z-30">
             {/* Left Zone - Hard */}
             <div 
                className="w-[20%] h-full group/left cursor-w-resize"
                onClick={(e) => handleSwipe('left', e)}
             >
                <div className="h-full w-full bg-gradient-to-r from-red-500/10 to-transparent opacity-0 group-hover/left:opacity-100 transition-opacity flex items-center justify-start pl-4">
                     <div className="bg-white dark:bg-slate-800 text-red-500 p-2 rounded-full shadow-lg transform -translate-x-full group-hover/left:translate-x-0 transition-transform duration-300">
                        <X size={20} />
                     </div>
                </div>
             </div>
             
             {/* Center Zone - Flip */}
             <div className="w-[60%] h-full" onClick={toggleFlip}></div>

             {/* Right Zone - Easy */}
             <div 
                className="w-[20%] h-full group/right cursor-e-resize"
                onClick={(e) => handleSwipe('right', e)}
             >
                <div className="h-full w-full bg-gradient-to-l from-green-500/10 to-transparent opacity-0 group-hover/right:opacity-100 transition-opacity flex items-center justify-end pr-4">
                    <div className="bg-white dark:bg-slate-800 text-green-500 p-2 rounded-full shadow-lg transform translate-x-full group-hover/right:translate-x-0 transition-transform duration-300">
                        <Check size={20} />
                     </div>
                </div>
             </div>
          </div>
        </div>

        {/* Back Side */}
        <div className="absolute inset-0 w-full h-full bg-[#312E81] text-white rounded-3xl shadow-card rotate-y-180 backface-hidden flex flex-col overflow-hidden border border-indigo-500 z-30">
          <div className="px-6 py-4 flex justify-between items-center border-b border-indigo-500/30 bg-indigo-900/50">
             <span className="text-xs font-bold uppercase tracking-wider text-indigo-200">Answer</span>
             <Lightbulb size={14} className="text-indigo-300" />
          </div>

          <div className="flex-1 p-6 flex flex-col justify-center items-center text-center overflow-y-auto">
            <div className={`${getAnswerSizeClass(currentCard.back)} font-display font-bold mb-3 leading-snug w-full`}>
              {renderCardText(currentCard.back, true)}
            </div>
            <div className="w-12 h-1 bg-indigo-500/50 rounded-full mb-3 flex-shrink-0"></div>
            <p className="text-indigo-100 leading-relaxed text-xs max-h-24 overflow-y-auto pr-2 flex-shrink-0">
              {currentCard.detail}
            </p>
          </div>
          
          <div className="p-6 bg-indigo-900/30 flex items-center justify-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-indigo-200/80">
              Swipe left or right to rate
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default InteractiveFlashcard;