import React from 'react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  sourceStage: 'bronze' | 'silver' | 'gold';
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  sourceStage,
}) => {
  if (!isOpen) return null;

  let title = 'Confirm Deletion';
  let description = 'Are you sure you want to delete this record?';
  let confirmText = 'Delete';
  let buttonBgColor = 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500';

  if (sourceStage === 'gold') {
    title = 'Revert to Staging';
    description = 'Are you sure you want to revert this Gold transaction to Silver staging? This will delete the confirmed Gold ledger record and return the staging transaction to pending or error status.';
    confirmText = 'Revert to Staging';
    buttonBgColor = 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500';
  } else if (sourceStage === 'silver') {
    title = 'Revert to Raw Email';
    description = 'Are you sure you want to revert this Silver staging transaction to a raw unprocessed Bronze email? This will delete the Silver staging transaction and mark the raw email as unprocessed.';
    confirmText = 'Revert to Raw';
    buttonBgColor = 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500';
  } else {
    title = 'Delete Raw Email';
    description = 'Are you sure you want to soft-delete this raw email? It will be moved to the Trash Bin, where you can restore it later if needed.';
    confirmText = 'Delete Email';
  }

  return (
    <div
      data-testid="delete-confirmation-modal"
      className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-fade-in"
    >
      <div className="bg-white rounded-2xl border border-gray-100 shadow-2xl max-w-md w-full overflow-hidden flex flex-col font-sans">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-950 uppercase tracking-wider">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-gray-600 text-sm leading-relaxed">
            {description}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl font-semibold text-xs cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2.5 ${buttonBgColor} text-white rounded-xl font-semibold text-xs cursor-pointer transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
            data-testid="confirm-delete-btn"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
