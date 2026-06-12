import React, { useState, useEffect } from 'react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (targets: string[]) => void;
  lineage: {
    bronzeId?: string;
    silverId?: string;
    goldId?: string;
  };
  sourceStage: 'bronze' | 'silver' | 'gold';
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  lineage,
  sourceStage,
}) => {
  const [selectedStages, setSelectedStages] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedStages([sourceStage]);
    }
  }, [isOpen, sourceStage]);

  if (!isOpen) return null;

  const handleCheckboxChange = (stage: string) => {
    setSelectedStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  };

  const handleConfirm = () => {
    if (selectedStages.length === 0) return;
    onConfirm(selectedStages);
  };

  // Determine which stages exist in lineage
  const hasBronze = !!lineage.bronzeId;
  const hasSilver = !!lineage.silverId;
  const hasGold = !!lineage.goldId;

  return (
    <div
      data-testid="delete-confirmation-modal"
      className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-white rounded-2xl border border-gray-100 shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
            Confirm Deletion
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          <p className="text-gray-600 font-medium">
            You are initiating deletion of this record. Please select which stages of the Medallion pipeline you would like to delete the data from:
          </p>

          <div className="space-y-3 pt-2">
            {hasBronze && (
              <label className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={selectedStages.includes('bronze')}
                  onChange={() => handleCheckboxChange('bronze')}
                  className="w-4 h-4 text-rose-600 border-gray-300 rounded focus:ring-rose-500 cursor-pointer"
                  data-testid="delete-stage-bronze"
                />
                <div>
                  <span className="font-bold text-gray-900 block">Bronze Stage (Raw Email)</span>
                  <span className="text-gray-500 text-[10px]">Soft-delete the ingested raw email from your history.</span>
                </div>
              </label>
            )}

            {hasSilver && (
              <label className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={selectedStages.includes('silver')}
                  onChange={() => handleCheckboxChange('silver')}
                  className="w-4 h-4 text-rose-600 border-gray-300 rounded focus:ring-rose-500 cursor-pointer"
                  data-testid="delete-stage-silver"
                />
                <div>
                  <span className="font-bold text-gray-900 block">Silver Stage (Staging Transaction)</span>
                  <span className="text-gray-500 text-[10px]">Soft-delete the pending extracted transaction from review queue.</span>
                </div>
              </label>
            )}

            {hasGold && (
              <label className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={selectedStages.includes('gold')}
                  onChange={() => handleCheckboxChange('gold')}
                  className="w-4 h-4 text-rose-600 border-gray-300 rounded focus:ring-rose-500 cursor-pointer"
                  data-testid="delete-stage-gold"
                />
                <div>
                  <span className="font-bold text-gray-900 block">Gold Stage (Verified Ledger)</span>
                  <span className="text-gray-500 text-[10px]">Soft-delete the double-entry validated ledger transaction.</span>
                </div>
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-100 rounded-xl font-bold uppercase tracking-wider text-[10px] cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedStages.length === 0}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold uppercase tracking-wider text-[10px] cursor-pointer transition-colors shadow-sm"
            data-testid="confirm-delete-btn"
          >
            Delete Selected
          </button>
        </div>
      </div>
    </div>
  );
};
