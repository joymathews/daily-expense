import React, { useState, useEffect } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getApiUrl } from '../utils/api-config';

interface TableMeta {
  name: string;
  columns: string[];
}

interface TableDataResponse {
  tableName: string;
  columns: string[];
  totalCount: number;
  limit: number;
  offset: number;
  rows: any[];
}

const DatabaseViewer: React.FC = () => {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('gold_transactions');
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Cell Inspector Modal state
  const [inspectCell, setInspectCell] = useState<{ columnName: string; value: any; rowId: string } | null>(null);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Fetch available tables list
  useEffect(() => {
    const loadTables = async () => {
      try {
        let authHeaders: Record<string, string> = {};
        try {
          const session = await fetchAuthSession();
          const token = session.tokens?.idToken?.toString();
          if (token) {
            authHeaders = { Authorization: `Bearer ${token}` };
          }
        } catch (err) {
          console.warn('Failed to fetch auth session:', err);
        }

        const res = await fetch(getApiUrl('/api/pipeline/db/tables'), { headers: authHeaders });
        if (!res.ok) throw new Error(`Failed to load tables: ${res.statusText}`);
        const data = await res.json();
        const loadedTables: TableMeta[] = data.tables || [];
        setTables(loadedTables);

        if (loadedTables.length > 0 && !loadedTables.some(t => t.name === selectedTable)) {
          setSelectedTable(loadedTables[0].name);
        }
        setIsLoadingTables(false);
      } catch (err: any) {
        setError(err.message || 'Error loading database tables');
        setIsLoadingTables(false);
      }
    };

    loadTables();
  }, []);

  // Fetch rows for selected table
  const fetchRows = async () => {
    if (!selectedTable) return;
    setIsLoadingRows(true);
    setError(null);

    try {
      let authHeaders: Record<string, string> = {};
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (token) {
          authHeaders = { Authorization: `Bearer ${token}` };
        }
      } catch (err) {
        console.warn('Failed to fetch auth session:', err);
      }

      const offset = (currentPage - 1) * pageSize;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
        ...(debouncedSearch ? { search: debouncedSearch } : {})
      });

      const res = await fetch(getApiUrl(`/api/pipeline/db/tables/${selectedTable}?${params.toString()}`), {
        headers: authHeaders
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to load raw table rows (${res.status})`);
      }

      const data: TableDataResponse = await res.json();
      setTableData(data);
      setIsLoadingRows(false);
    } catch (err: any) {
      setError(err.message || 'Failed to query table data');
      setIsLoadingRows(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [selectedTable, currentPage, pageSize, debouncedSearch]);

  const handleTableChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTable(e.target.value);
    setCurrentPage(1);
    setSearchTerm('');
  };

  const formatCellValue = (val: any) => {
    if (val === null || val === undefined) {
      return <span className="text-gray-300 italic">null</span>;
    }
    if (typeof val === 'object') {
      return <span className="font-mono text-indigo-650 font-medium">{JSON.stringify(val)}</span>;
    }
    const str = String(val);
    if (str.length > 45) {
      return <span className="font-mono text-gray-700">{str.substring(0, 42)}...</span>;
    }
    return <span className="font-mono text-gray-800">{str}</span>;
  };

  const totalPages = tableData ? Math.ceil(tableData.totalCount / pageSize) : 1;

  if (isLoadingTables) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-650 border-t-transparent"></div>
        <p className="text-gray-500 font-medium Outfit">Loading database schemas...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 w-full px-2 sm:px-0">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-2 md:space-y-0">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent Outfit">
            Database Raw Table Viewer
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Inspect raw SQLite table schemas, record counts, and cell values across Medallion layers like an in-app SQLite client.
          </p>
        </div>
        <button
          onClick={fetchRows}
          disabled={isLoadingRows}
          className="inline-flex items-center justify-center px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-150 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-indigo-100 transition-all shadow-sm cursor-pointer disabled:opacity-50"
        >
          {isLoadingRows ? 'Querying...' : '🔄 Refresh View'}
        </button>
      </div>

      {/* Control Bar: Table Selector, Search, Page Size */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 shadow-sm rounded-2xl p-5 space-y-4 md:space-y-0 md:flex md:items-center md:justify-between md:space-x-4">
        <div className="flex items-center space-x-3 flex-grow max-w-md">
          <label className="text-xs font-bold text-gray-550 uppercase tracking-wider whitespace-nowrap">
            Active Table:
          </label>
          <select
            value={selectedTable}
            onChange={handleTableChange}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          >
            {tables.map(t => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.columns.length} cols)
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-3 flex-grow max-w-lg">
          <input
            type="text"
            placeholder="Search raw cell values..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-xs text-gray-400 hover:text-gray-600 font-bold px-2"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2 whitespace-nowrap">
          <span className="text-xs text-gray-400 font-medium">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Table Metadata Banner */}
      {tableData && (
        <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl px-5 py-3 flex items-center justify-between text-xs text-indigo-900 font-medium Outfit">
          <div className="flex items-center space-x-4">
            <span>
              Table: <strong className="font-mono text-indigo-700">{tableData.tableName}</strong>
            </span>
            <span>•</span>
            <span>
              Total Records: <strong className="text-gray-900">{(tableData.totalCount ?? 0).toLocaleString()}</strong>
            </span>
            <span>•</span>
            <span>
              Columns: <strong className="text-gray-900">{(tableData.columns || []).length}</strong>
            </span>
          </div>
          {debouncedSearch && (
            <span className="bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-md font-bold text-2xs">
              Filtered by "{debouncedSearch}"
            </span>
          )}
        </div>
      )}


      {/* Error Message */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Main Data Grid */}
      <div className="bg-white/80 backdrop-blur-md border border-gray-100 shadow-sm rounded-2xl overflow-hidden">
        {isLoadingRows ? (
          <div className="flex flex-col items-center justify-center p-12 space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-3 border-indigo-650 border-t-transparent"></div>
            <p className="text-xs text-gray-400 font-medium font-mono">Fetching raw records from {selectedTable}...</p>
          </div>
        ) : !tableData || !Array.isArray(tableData.rows) || tableData.rows.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-semibold text-gray-400 Outfit">No records found in table `{selectedTable}`.</p>
            {debouncedSearch && <p className="text-xs text-gray-400 mt-1">Try clearing your search query.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto max-w-full">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50/90 border-b border-gray-100 text-gray-500 font-bold uppercase tracking-wider font-mono text-[11px]">
                  <th className="px-3 py-3 w-12 text-center border-r border-gray-100">#</th>
                  {(tableData.columns || []).map(col => (
                    <th key={col} className="px-4 py-3 whitespace-nowrap border-r border-gray-100/60">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100/80 bg-white">
                {(tableData.rows || []).map((row, idx) => {
                  const rowNum = (currentPage - 1) * pageSize + idx + 1;
                  const rowId = row.id || `row-${idx}`;
                  return (
                    <tr key={rowId} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="px-3 py-2.5 text-center text-gray-400 font-mono text-[10px] border-r border-gray-100 bg-gray-50/40">
                        {rowNum}
                      </td>
                      {(tableData.columns || []).map(col => {
                        const rawVal = row[col];
                        return (
                          <td
                            key={col}
                            onClick={() => setInspectCell({ columnName: col, value: rawVal, rowId })}
                            className="px-4 py-2.5 max-w-[240px] truncate cursor-pointer hover:bg-indigo-100/50 transition-colors border-r border-gray-100/60"
                            title="Click to view full un-truncated value"
                          >
                            {formatCellValue(rawVal)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {tableData && (tableData.totalCount ?? 0) > 0 && (
          <div className="bg-gray-50/80 border-t border-gray-100 px-6 py-3 flex items-center justify-between text-xs text-gray-500">
            <div>
              Showing <span className="font-bold text-gray-800">{(currentPage - 1) * pageSize + 1}</span> to{' '}
              <span className="font-bold text-gray-800">
                {Math.min(currentPage * pageSize, tableData.totalCount ?? 0)}
              </span>{' '}
              of <span className="font-bold text-gray-800">{(tableData.totalCount ?? 0).toLocaleString()}</span> entries
            </div>


            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1 || isLoadingRows}
                className="px-3 py-1 bg-white border border-gray-200 rounded-md text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-40 transition-all cursor-pointer"
              >
                Previous
              </button>
              <span className="text-xs font-bold text-gray-700 px-2 font-mono">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages || isLoadingRows}
                className="px-3 py-1 bg-white border border-gray-200 rounded-md text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-40 transition-all cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Raw Cell Value Inspector Modal */}
      {inspectCell && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl max-w-2xl w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-gray-900 Outfit">Cell Value Inspector</h3>
                <p className="text-xs text-gray-400 font-mono mt-0.5">
                  Column: <span className="font-bold text-indigo-600">{inspectCell.columnName}</span> | Row: {inspectCell.rowId}
                </p>
              </div>
              <button
                onClick={() => setInspectCell(null)}
                className="text-gray-400 hover:text-gray-700 font-bold text-lg p-1"
              >
                &times;
              </button>
            </div>

            <div className="bg-gray-900 rounded-xl p-4 text-gray-100 font-mono text-xs max-h-96 overflow-auto border border-gray-800">
              {inspectCell.value === null || inspectCell.value === undefined ? (
                <span className="text-gray-500 italic">null</span>
              ) : typeof inspectCell.value === 'object' ? (
                <pre>{JSON.stringify(inspectCell.value, null, 2)}</pre>
              ) : (
                <pre className="whitespace-pre-wrap break-words">{String(inspectCell.value)}</pre>
              )}
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => {
                  const val = typeof inspectCell.value === 'object' 
                    ? JSON.stringify(inspectCell.value, null, 2) 
                    : String(inspectCell.value ?? '');
                  navigator.clipboard.writeText(val);
                }}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                📋 Copy Content
              </button>
              <button
                onClick={() => setInspectCell(null)}
                className="px-4 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatabaseViewer;
