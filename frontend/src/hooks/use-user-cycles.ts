import { useState, useEffect, useCallback } from 'react';
import type { UserCycleFrontend } from '../utils/cycle-helper';

const generateClientDefaultCycles = (startDay = 17): UserCycleFrontend[] => {
  const result: UserCycleFrontend[] = [];
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth();
  const curDate = now.getUTCDate();

  let activeStartYear = curYear;
  let activeStartMonth = curMonth;
  if (curDate < startDay) {
    activeStartMonth -= 1;
    if (activeStartMonth < 0) {
      activeStartMonth = 11;
      activeStartYear -= 1;
    }
  }

  for (let offset = 0; offset >= -12; offset--) {
    const d = new Date(Date.UTC(activeStartYear, activeStartMonth + offset, startDay));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const startDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
    const startTimestamp = `${startDateStr}T00:00:00.000Z`;

    const isCurrent = (offset === 0);

    let endDateStr: string | null = null;
    let endTimestamp: string | null = null;
    let totalDays: number | null = null;

    if (!isCurrent) {
      const nextD = new Date(Date.UTC(year, month + 1, startDay));
      const nextYear = nextD.getUTCFullYear();
      const nextMonth = nextD.getUTCMonth();
      
      const prevD = new Date(Date.UTC(nextYear, nextMonth, startDay - 1));
      endDateStr = `${prevD.getUTCFullYear()}-${String(prevD.getUTCMonth() + 1).padStart(2, '0')}-${String(prevD.getUTCDate()).padStart(2, '0')}`;
      
      const endMs = nextD.getTime() - 1;
      endTimestamp = new Date(endMs).toISOString();
      totalDays = Math.round((nextD.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const labelEnd = endDateStr ? `${monthNames[new Date(endDateStr).getUTCMonth()]} ${new Date(endDateStr).getUTCDate()}` : 'Present';
    const cycleName = `${monthNames[month]} ${startDay} – ${labelEnd}`;

    result.push({
      id: `default-${startDateStr}`,
      cycleName,
      startType: 'default',
      startDate: startDateStr,
      startTimestamp,
      endDate: endDateStr,
      endTimestamp,
      totalDays,
      isCurrent,
    });
  }

  return result;
};

export function useUserCycles() {
  const [cycles, setCycles] = useState<UserCycleFrontend[]>([]);
  const [activeCycle, setActiveCycle] = useState<UserCycleFrontend | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<UserCycleFrontend | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuthSession = async (): Promise<Record<string, string>> => {
    try {
      const authAmplify = await import('aws-amplify/auth');
      const session = await authAmplify.fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  };

  const loadCycles = useCallback(async () => {
    setLoading(true);
    setError(null);
    let headers = {};
    try {
      const authAmplify = await import('aws-amplify/auth');
      const session = await authAmplify.fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (token) headers = { Authorization: `Bearer ${token}` };
    } catch {
      headers = {};
    }

    try {
      const res = await fetch('/api/pipeline/user-cycles', { headers });
      if (res.status && res.status >= 400) throw new Error('Failed to fetch user cycles');
      const data = await res.json();
      setCycles(data.cycles || []);
      setActiveCycle(data.activeCycle || null);
      if (!selectedCycle && data.activeCycle) {
        setSelectedCycle(data.activeCycle);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading cycles');
      // Fallback client default cycles for test/offline resilience
      const fallback = generateClientDefaultCycles(17);
      setCycles(fallback);
      const active = fallback.find(c => c.isCurrent) || fallback[0];
      setActiveCycle(active);
      if (!selectedCycle) setSelectedCycle(active);
    } finally {
      setLoading(false);
    }
  }, []);


  useEffect(() => {
    loadCycles();
  }, []);

  const setCycleOverride = async (payload: {
    startType: 'default' | 'transaction' | 'date';
    startTransactionId?: string;
    startDate: string;
    startTimestamp: string;
    cycleName?: string;
  }) => {
    try {
      const headers = await fetchAuthSession();
      const res = await fetch('/api/pipeline/user-cycles/override', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save cycle override');
      const data = await res.json();
      setCycles(data.cycles || []);
      const newActive = (data.cycles || []).find((c: UserCycleFrontend) => c.isCurrent);
      if (newActive) setActiveCycle(newActive);
      return data;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to save cycle override');
    }
  };

  const removeCycleOverride = async (cycleId: string) => {
    try {
      const headers = await fetchAuthSession();
      const res = await fetch(`/api/pipeline/user-cycles/override/${cycleId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Failed to delete cycle override');
      const data = await res.json();
      setCycles(data.cycles || []);
      const newActive = (data.cycles || []).find((c: UserCycleFrontend) => c.isCurrent);
      if (newActive) setActiveCycle(newActive);
      return data;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete cycle override');
    }
  };

  return {
    cycles,
    activeCycle,
    selectedCycle: selectedCycle || activeCycle,
    setSelectedCycle,
    loading,
    error,
    reloadCycles: loadCycles,
    setCycleOverride,
    removeCycleOverride,
  };
}
