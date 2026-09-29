import React, { useState, useEffect } from 'react';
import { Check, CheckCircle, XCircle, ArrowRight, Trophy, ThumbsUp, Zap } from 'lucide-react';
import { QuizQuestion } from '../types';

interface InteractiveQuizProps {
  questions?: QuizQuestion[];
  /** Called when the quiz is finished with total score (0–100) and number correct */
  onQuizComplete?: (score: number, totalCorrect: number, totalQuestions: number) => void;
}

const InteractiveQuiz: React.FC<InteractiveQuizProps> = ({ questions, onQuizComplete }) => {
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [quizFinished, setQuizFinished] = useState(false);

  const data = questions ?? [];
  const currentQuestion = data[currentQIndex];

  useEffect(() => {
    setCurrentQIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setCorrectCount(0);
    setQuizFinished(false);
  }, [questions]);

  const handleSelect = (id: string) => {
    if (isAnswered) return;
    setSelectedOption(id);
    setIsAnswered(true);
    if (id === currentQuestion.correctId) {
      setCorrectCount(prev => prev + 1);
    }
  };

  const nextQuestion = () => {
    // If this was the last question, fire completion callback
    if (currentQIndex === data.length - 1) {
      const finalCorrect = correctCount; // already updated in handleSelect
      const score = data.length > 0 ? Math.round((finalCorrect / data.length) * 100) : 0;
      setQuizFinished(true);
      onQuizComplete?.(score, finalCorrect, data.length);
      return;
    }
    setSelectedOption(null);
    setIsAnswered(false);
    setCurrentQIndex((prev) => prev + 1);
  };

  const handleRetry = () => {
    setCurrentQIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setCorrectCount(0);
    setQuizFinished(false);
  };

  return (
    <div className="w-full">
      {/* Main Card - full width of container, no stacked cards to avoid empty space */}
      <div className="w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 md:px-4 md:py-3 text-white">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded">Knowledge Check</span>
            <span className="text-xs opacity-90">Q{currentQIndex + 1}/{data.length}</span>
          </div>
          <div className="h-1 bg-black/20 rounded-full w-full">
            <div 
              className="h-1 bg-white rounded-full transition-all duration-300" 
              style={{ width: `${data.length ? ((currentQIndex + 1) / data.length) * 100 : 0}%` }}
            ></div>
          </div>
        </div>
        
        <div className="p-3 md:p-4">
          {quizFinished ? (
            <div className="text-center py-4">
              <div className="mb-2 flex justify-center">
                {correctCount === data.length
                  ? <Trophy size={40} className="text-yellow-500" />
                  : correctCount >= data.length * 0.7
                  ? <ThumbsUp size={40} className="text-blue-500" />
                  : <Zap size={40} className="text-orange-500" />}
              </div>
              <h3 className="text-xl font-bold text-text-light dark:text-text-dark mb-1">Quiz Complete!</h3>
              <p className="text-sm text-text-muted mb-0.5">
                You scored <span className="font-bold text-primary">{correctCount}/{data.length}</span>
              </p>
              <p className="text-xs text-text-muted mb-3">
                ({Math.round((correctCount / data.length) * 100)}% correct)
              </p>
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-bold text-sm transition"
              >
                Try Again
              </button>
            </div>
          ) : !currentQuestion ? (
            <p className="text-sm text-text-muted text-center py-4">No questions for this lesson yet.</p>
          ) : (
          <>
          <p className="text-base md:text-lg font-bold text-text-light dark:text-text-dark mb-3 md:mb-3 leading-snug">
            {currentQuestion.question}
          </p>
          
          <div className="space-y-2 md:space-y-2 mb-3 md:mb-3">
            {currentQuestion.options.map((option) => {
              const isSelected = selectedOption === option.id;
              const isCorrect = option.id === currentQuestion.correctId;
              
              let borderClass = "border-gray-200 dark:border-slate-700";
              let bgClass = "bg-transparent";
              let icon: React.ReactNode = null;

              if (isAnswered) {
                if (isCorrect) {
                  borderClass = "border-green-500";
                  bgClass = "bg-green-50 dark:bg-green-900/20";
                  icon = <CheckCircle size={18} className="text-green-500" />;
                } else if (isSelected && !isCorrect) {
                  borderClass = "border-red-500";
                  bgClass = "bg-red-50 dark:bg-red-900/20";
                  icon = <XCircle size={18} className="text-red-500" />;
                } else if (!isSelected && !isCorrect) {
                  bgClass = "opacity-50";
                }
              } else if (isSelected) {
                borderClass = "border-blue-500";
              }

              return (
                <div 
                  key={option.id}
                  onClick={() => handleSelect(option.id)}
                  className={`flex items-center p-2.5 md:p-3 border-2 rounded-lg cursor-pointer transition shadow-sm ${borderClass} ${bgClass}`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mr-3 shrink-0 ${
                    isAnswered && isCorrect ? 'bg-green-500 border-green-500 text-white' : 
                    isAnswered && isSelected && !isCorrect ? 'bg-red-500 border-red-500 text-white' :
                    'border-gray-300 dark:border-slate-600'
                  }`}>
                    {(isAnswered && (isCorrect || isSelected)) && <Check size={12} />}
                  </div>
                  <span className="font-medium text-sm md:text-base text-text-light dark:text-text-dark">{option.text}</span>
                  {icon && <span className="ml-auto">{icon}</span>}
                </div>
              );
            })}
          </div>

          {isAnswered && (
             <div className="mb-3 text-xs md:text-sm text-text-muted bg-gray-50 dark:bg-slate-900/50 p-3 rounded-lg border border-gray-100 dark:border-slate-700">
               <span className="font-bold block mb-1">Explanation:</span>
               {currentQuestion.explanation}
             </div>
          )}

          <button 
            onClick={nextQuestion}
            disabled={!isAnswered}
            className={`w-full py-2.5 md:py-3 rounded-lg font-bold text-sm transition shadow-lg flex items-center justify-center ${
              isAnswered 
                ? 'bg-green-600 text-white shadow-green-600/20 hover:bg-green-700' 
                : 'bg-gray-200 dark:bg-slate-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            {currentQIndex === data.length - 1 ? 'Finish' : 'Next'}
            <ArrowRight size={14} className="ml-1.5" />
          </button>
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default InteractiveQuiz;