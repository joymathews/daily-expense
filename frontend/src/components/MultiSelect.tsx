import React, { useState, useRef, useEffect } from 'react';

interface MultiSelectProps {
  id: string;
  label: string;
  options: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  id,
  label,
  options,
  selectedValues,
  onChange,
  placeholder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleToggleOption = (option: string) => {
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter(v => v !== option));
    } else {
      onChange([...selectedValues, option]);
    }
  };

  const handleSelectAll = () => {
    onChange([...options]);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const getButtonText = () => {
    if (selectedValues.length === 0 || selectedValues.length === options.length) {
      return placeholder;
    }
    if (selectedValues.length <= 2) {
      return selectedValues.join(', ');
    }
    return `${selectedValues.length} Selected`;
  };

  return (
    <div className="flex flex-col min-w-[150px] relative" ref={containerRef}>
      <label htmlFor={id} className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <button
        id={id}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gray-50/50 border border-gray-200 rounded-xl outline-none text-xs font-bold text-gray-800 px-3.5 py-2 focus:border-indigo-500 focus:bg-white transition-all cursor-pointer flex justify-between items-center w-full min-h-[34px]"
      >
        <span className="truncate mr-2">{getButtonText()}</span>
        <svg
          className={`w-3 h-3 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-[56px] left-0 w-full bg-white border border-gray-200 rounded-2xl shadow-xl z-50 p-3 space-y-2 animate-fade-in max-h-60 overflow-y-auto min-w-[180px]">
          {/* Quick Select Actions */}
          <div className="flex justify-between items-center pb-2 border-b border-gray-100 text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider">
            <button type="button" onClick={handleSelectAll} className="hover:text-indigo-800 transition-colors">
              Select All
            </button>
            <button type="button" onClick={handleClearAll} className="hover:text-indigo-800 transition-colors">
              Clear All
            </button>
          </div>

          {/* Options List */}
          <div className="space-y-1.5">
            {options.map((option) => {
              const isChecked = selectedValues.includes(option);
              return (
                <label
                  key={option}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-xs font-bold text-gray-700 transition-all select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleOption(option)}
                    className="rounded text-indigo-600 border-gray-300 focus:ring-indigo-500 w-3.5 h-3.5"
                  />
                  <span className="truncate">{option}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
