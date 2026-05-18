import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import type { CommentPatch } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toTask } from '@/lib/mappers';
import { Task, Comment } from '@/constants/types';
import { genId, nowTimestampFR } from '@/lib/utils';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const TASKS_CACHE_KEY = 'buildtrack_tasks_cache_v1';

export function useTasks() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    if (!userId) return;
    readCache<Task>(TASKS_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Task[]>(queryKeys.tasks());
      if (!rqCurrent?.length) return;
      const manualIds = new Set(manualCached.map(t => t.id));
      if (rqCurrent.some(t => !manualIds.has(t.id))) {
        queryClient.setQueryData<Task[]>(queryKeys.tasks(), rqCurrent.filter(t => manualIds.has(t.id)));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const query = useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: async (): Promise<Task[]> => {
      let cached = await readCache<Task>(TASKS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Task[]>(queryKeys.tasks());
      if (!cached && rqCached?.length) cached = rqCached;
      if (!isSupabaseConfigured) return cached ?? [];
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];
      try {
        let q = ((supabase as any).from('tasks') as any).select('*');
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map(toTask);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'tasks');
        const merged = mergeWithCache<Task>(fresh, cached, pendingIds, { queueLoaded });
        await writeCache(TASKS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn(`[useTasks] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user,
  });

  const persist = useCallback((tasks: Task[]) => {
    writeCache(TASKS_CACHE_KEY, tasks, userId);
  }, [userId]);

  const addTask = useCallback(async (t: Task) => {
    const orgId = user?.organizationId ?? null;
    queryClient.setQueryData<Task[]>(queryKeys.tasks(), old => {
      if ((old ?? []).some(x => x.id === t.id)) return old ?? [];
      return [t, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);
    const payload = {
      id: t.id, title: t.title ?? '',
      description: t.description ?? '',
      status: t.status ?? 'todo',
      priority: t.priority ?? 'medium',
      start_date: t.startDate ?? null,
      deadline: t.deadline ?? null,
      assignee: t.assignee ?? '',
      progress: t.progress ?? 0,
      company: t.company ?? '',
      reserve_id: t.reserveId ?? null, comments: t.comments ?? [], history: t.history ?? [],
      chantier_id: t.chantierId ?? null, created_at: t.createdAt ?? new Date().toISOString(),
      organization_id: orgId,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'tasks', op: 'insert', data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('tasks').insert(payload);
      if (error) {
        console.warn('[sync] addTask error, queuing for retry:', error.message);
        enqueueOperation({ table: 'tasks', op: 'insert', data: payload });
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const updateTask = useCallback(async (t: Task) => {
    queryClient.setQueryData<Task[]>(queryKeys.tasks(), old =>
      (old ?? []).map(x => x.id === t.id ? t : x)
    );
    persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);
    const payload = {
      title: t.title ?? '',
      description: t.description ?? '',
      status: t.status ?? 'todo',
      priority: t.priority ?? 'medium',
      start_date: t.startDate ?? null,
      deadline: t.deadline ?? null,
      assignee: t.assignee ?? '',
      progress: t.progress ?? 0,
      company: t.company ?? '',
      reserve_id: t.reserveId ?? null, comments: t.comments ?? [], history: t.history ?? [],
      chantier_id: t.chantierId ?? null,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'tasks', op: 'update', filter: { column: 'id', value: t.id }, data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('tasks').update(payload).eq('id', t.id);
      if (error) {
        console.warn('[sync] updateTask error, queuing for retry:', error.message);
        enqueueOperation({ table: 'tasks', op: 'update', filter: { column: 'id', value: t.id }, data: payload });
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  const deleteTask = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? [];
    const previous = prev.find(t => t.id === id);
    queryClient.setQueryData<Task[]>(queryKeys.tasks(), prev.filter(t => t.id !== id));
    persist(prev.filter(t => t.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'tasks', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any).from('tasks').delete().eq('id', id).select();
      if (error) {
        console.warn('[sync] deleteTask erreur serveur:', error.code, error.message);
        const isPermissionDenied = error.code === '42501' || /row-level security|permission denied/i.test(error.message ?? '');
        if (isPermissionDenied && previous) {
          queryClient.setQueryData<Task[]>(queryKeys.tasks(), old => [previous, ...(old ?? [])]);
          persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);
          Alert.alert('Suppression refusée', "Vous n'avez pas les droits pour supprimer cette tâche, ou elle n'existe plus sur le serveur.");
        } else {
          console.warn('[sync] deleteTask: erreur réseau/session, opération enqueued pour retry');
          enqueueOperation({ table: 'tasks', op: 'delete', filter: { column: 'id', value: id } });
        }
      } else if (!deleted?.length) {
        console.warn('[sync] deleteTask: aucune ligne supprimée');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  // ── Shared helper: enqueue a comment delta ──────────────────────────────────
  // Used by the three comment mutation functions below for both the error-retry
  // path (online write failed) and the offline-first path (no connection).
  // Storing a delta (patch) instead of a full comments array snapshot makes the
  // sync engine safe in the face of concurrent writes from other devices: each
  // op is merged server-side by comment ID rather than blindly overwriting.
  const enqueueCommentPatch = useCallback((taskId: string, patch: CommentPatch) => {
    enqueueOperation({
      table: 'tasks',
      op: 'update',
      filter: { column: 'id', value: taskId },
      commentPatch: patch,
      // No `data` — the engine uses commentPatch exclusively when it is set.
    });
  }, [enqueueOperation]);

  const addTaskComment = useCallback(async (taskId: string, content: string, author?: string) => {
    const tasks = queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const comment: Comment = {
      id: genId(),
      content,
      author: author ?? user?.name ?? 'Inconnu',
      authorId: user?.id,
      createdAt: nowTimestampFR(),
    };
    const patch: CommentPatch = { action: 'add', comment };

    // Optimistic update: append the comment to the local cache
    const optimistic: Task = { ...task, comments: [...(task.comments ?? []), comment] };
    queryClient.setQueryData<Task[]>(queryKeys.tasks(), old =>
      (old ?? []).map(t => t.id === taskId ? optimistic : t)
    );
    persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);

    if (!isSupabaseConfigured) return;

    // Online path: fetch server comments then merge by ID — safe against
    // concurrent writes from other devices since the last cache refresh.
    try {
      const { data: serverTask, error: fetchErr } = await (supabase as any)
        .from('tasks').select('comments').eq('id', taskId).maybeSingle();
      if (fetchErr) throw fetchErr;
      const serverComments: Comment[] = Array.isArray(serverTask?.comments)
        ? serverTask.comments : [];
      const merged = serverComments.some(c => c.id === comment.id)
        ? serverComments
        : [...serverComments, comment];
      const { error: writeErr } = await (supabase as any)
        .from('tasks').update({ comments: merged }).eq('id', taskId);
      if (writeErr) throw writeErr;
      // Reconcile local cache with the actual server state
      queryClient.setQueryData<Task[]>(queryKeys.tasks(), old =>
        (old ?? []).map(t => t.id === taskId ? { ...t, comments: merged } : t)
      );
      persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);
    } catch (err: any) {
      console.warn('[sync] addTaskComment error, queuing delta for retry:', err?.message ?? err);
      enqueueCommentPatch(taskId, patch);
    }
  }, [queryClient, user, isOnlineRef, enqueueCommentPatch, persist]);

  const updateTaskComment = useCallback(async (taskId: string, commentId: string, newContent: string) => {
    const tasks = queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const target = (task.comments ?? []).find(c => c.id === commentId);
    if (!target) return;
    const isOwner = (target.authorId && user?.id && target.authorId === user.id) ||
                    (!target.authorId && target.author === user?.name);
    if (!isOwner) return;

    const editedAt = nowTimestampFR();
    const patch: CommentPatch = { action: 'edit', commentId, newContent, editedAt };

    // Optimistic update
    const optimisticComments = (task.comments ?? []).map(c =>
      c.id === commentId ? { ...c, content: newContent, editedAt } : c
    );
    queryClient.setQueryData<Task[]>(queryKeys.tasks(), old =>
      (old ?? []).map(t => t.id === taskId ? { ...t, comments: optimisticComments } : t)
    );
    persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);

    if (!isSupabaseConfigured) return;

    // Online path: fetch-then-merge by ID
    try {
      const { data: serverTask, error: fetchErr } = await (supabase as any)
        .from('tasks').select('comments').eq('id', taskId).maybeSingle();
      if (fetchErr) throw fetchErr;
      const serverComments: Comment[] = Array.isArray(serverTask?.comments)
        ? serverTask.comments : [];
      const merged = serverComments.map(c =>
        c.id === commentId ? { ...c, content: newContent, editedAt } : c
      );
      const { error: writeErr } = await (supabase as any)
        .from('tasks').update({ comments: merged }).eq('id', taskId);
      if (writeErr) throw writeErr;
      queryClient.setQueryData<Task[]>(queryKeys.tasks(), old =>
        (old ?? []).map(t => t.id === taskId ? { ...t, comments: merged } : t)
      );
      persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);
    } catch (err: any) {
      console.warn('[sync] updateTaskComment error, queuing delta for retry:', err?.message ?? err);
      enqueueCommentPatch(taskId, patch);
    }
  }, [queryClient, user, isOnlineRef, enqueueCommentPatch, persist]);

  const deleteTaskComment = useCallback(async (taskId: string, commentId: string) => {
    const tasks = queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const target = (task.comments ?? []).find(c => c.id === commentId);
    if (!target) return;
    const isOwner = (target.authorId && user?.id && target.authorId === user.id) ||
                    (!target.authorId && target.author === user?.name);
    if (!isOwner) return;

    const patch: CommentPatch = { action: 'delete', commentId };

    // Optimistic update
    const optimisticComments = (task.comments ?? []).filter(c => c.id !== commentId);
    queryClient.setQueryData<Task[]>(queryKeys.tasks(), old =>
      (old ?? []).map(t => t.id === taskId ? { ...t, comments: optimisticComments } : t)
    );
    persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);

    if (!isSupabaseConfigured) return;

    // Online path: fetch-then-merge by ID
    try {
      const { data: serverTask, error: fetchErr } = await (supabase as any)
        .from('tasks').select('comments').eq('id', taskId).maybeSingle();
      if (fetchErr) throw fetchErr;
      const serverComments: Comment[] = Array.isArray(serverTask?.comments)
        ? serverTask.comments : [];
      const merged = serverComments.filter(c => c.id !== commentId);
      const { error: writeErr } = await (supabase as any)
        .from('tasks').update({ comments: merged }).eq('id', taskId);
      if (writeErr) throw writeErr;
      queryClient.setQueryData<Task[]>(queryKeys.tasks(), old =>
        (old ?? []).map(t => t.id === taskId ? { ...t, comments: merged } : t)
      );
      persist(queryClient.getQueryData<Task[]>(queryKeys.tasks()) ?? []);
    } catch (err: any) {
      console.warn('[sync] deleteTaskComment error, queuing delta for retry:', err?.message ?? err);
      enqueueCommentPatch(taskId, patch);
    }
  }, [queryClient, user, isOnlineRef, enqueueCommentPatch, persist]);

  return {
    tasks: query.data ?? [],
    isLoadingTasks: query.isLoading,
    addTask,
    updateTask,
    deleteTask,
    addTaskComment,
    updateTaskComment,
    deleteTaskComment,
    invalidateTasks: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks() }),
  };
}
