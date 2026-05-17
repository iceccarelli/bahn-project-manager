/**
2	 * useDataQuery.ts — Data Hooks with TanStack Query
3	 * 
4	 * Refactored from useData.ts to use useQuery/useMutation
5	 * Provides proper caching, invalidation, and optimistic updates
6	 */
7	
8	import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
9	import { useCallback, useMemo } from "react";
10	import { apiClient } from "@/_core/api/client";
11	import type {
12	  Project,
13	  Review,
14	  Stats,
15	  Filters,
16	  ProjectUpdateInput,
17	  ReviewUpdateInput,
18	  ProjectCreateInput,
19	  AuditLogEntry,
20	} from "@/_core/api/client";
21	
22	// ============================================================================
23	// QUERY KEYS (for cache invalidation)
24	// ============================================================================
25	
26	export const queryKeys = {
27	  projects: {
28	    all: ["projects"] as const,
29	    list: () => [...queryKeys.projects.all, "list"] as const,
30	    detail: (id: number) => [...queryKeys.projects.all, "detail", id] as const,
31	  },
32	  stats: {
33	    all: ["stats"] as const,
34	    dashboard: () => [...queryKeys.stats.all, "dashboard"] as const,
35	  },
36	  audit: {
37	    all: ["audit"] as const,
38	    list: () => [...queryKeys.audit.all, "list"] as const,
39	  },
40	};
41	
42	// ============================================================================
43	// QUERY HOOKS
44	// ============================================================================
45	
46	/**
47	 * Fetch all projects
48	 */
49	export function useAllProjects() {
50	  return useQuery({
51	    queryKey: queryKeys.projects.list(),
52	    queryFn: () => apiClient.projects.list(),
53	  });
54	}
55	
56	/**
57	 * Fetch single project by ID
58	 */
59	export function useProject(id: number) {
60	  return useQuery({
61	    queryKey: queryKeys.projects.detail(id),
62	    queryFn: () => apiClient.projects.get(id),
63	  });
64	}
65	
66	/**
67	 * Fetch dashboard stats
68	 */
69	export function useDashboardStats() {
70	  return useQuery({
71	    queryKey: queryKeys.stats.dashboard(),
72	    queryFn: () => apiClient.dashboard.getStats(),
73	  });
74	}
75	
76	/**
77	 * Fetch audit log
78	 */
79	export function useAuditLog() {
80	  return useQuery({
81	    queryKey: queryKeys.audit.list(),
82	    queryFn: () => apiClient.audit.list(),
83	  });
84	}
85	
86	// ============================================================================
87	// MUTATION HOOKS
88	// ============================================================================
89	
90	/**
91	 * Create new project
92	 */
93	export function useCreateProject() {
94	  const queryClient = useQueryClient();
95	
96	  return useMutation({
97	    mutationFn: (input: ProjectCreateInput) => apiClient.projects.create(input),
98	    onSuccess: (newProject) => {
99	      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
100	      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
101	      queryClient.setQueryData(queryKeys.projects.detail(newProject.id), newProject);
102	    },
103	  });
104	}
105	
106	/**
107	 * Update project field
108	 */
109	export function useUpdateProject() {
110	  const queryClient = useQueryClient();
111	
112	  return useMutation({
113	    mutationFn: (input: ProjectUpdateInput) => apiClient.projects.update(input),
114	    onMutate: async (input) => {
115	      await queryClient.cancelQueries({ queryKey: queryKeys.projects.list() });
116	      const previousProjects = queryClient.getQueryData<Project[]>(queryKeys.projects.list());
117	
118	      if (previousProjects) {
119	        const updated = previousProjects.map((p) =>
120	          p.id === input.id ? { ...p, [input.field]: input.value } : p
121	        );
122	        queryClient.setQueryData(queryKeys.projects.list(), updated);
123	      }
124	
125	      return { previousProjects };
126	    },
127	    onError: (err, input, context) => {
128	      if (context?.previousProjects) {
129	        queryClient.setQueryData(queryKeys.projects.list(), context.previousProjects);
130	      }
131	    },
132	    onSuccess: () => {
133	      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
134	    },
135	  });
136	}
137	
138	/**
139	 * Update review
140	 */
141	export function useUpdateReview() {
142	  const queryClient = useQueryClient();
143	
144	  return useMutation({
145	    mutationFn: (input: ReviewUpdateInput) => apiClient.reviews.update(input),
146	    onMutate: async (input) => {
147	      await queryClient.cancelQueries({ queryKey: queryKeys.projects.list() });
148	      const previousProjects = queryClient.getQueryData<Project[]>(queryKeys.projects.list());
149	
150	      if (previousProjects) {
151	        const updated = previousProjects.map((p) => {
152	          if (p.id !== input.projectId) return p;
153	          return {
154	            ...p,
155	            reviews: p.reviews.map((r) =>
156	              r.department === input.department
157	                ? { ...r, [input.field]: input.value }
158	                : r
159	            ),
160	          };
161	        });
162	        queryClient.setQueryData(queryKeys.projects.list(), updated);
163	      }
164	
165	      return { previousProjects };
166	    },
167	    onError: (err, input, context) => {
168	      if (context?.previousProjects) {
169	        queryClient.setQueryData(queryKeys.projects.list(), context.previousProjects);
170	      }
171	    },
172	    onSuccess: () => {
173	      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
174	    },
175	  });
176	}
177	
178	/**
179	 * Delete project
180	 */
181	export function useDeleteProject() {
182	  const queryClient = useQueryClient();
183	
184	  return useMutation({
185	    mutationFn: (id: number) => apiClient.projects.delete(id),
186	    onSuccess: () => {
187	      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
188	      queryClient.invalidateQueries({ queryKey: queryKeys.stats.dashboard() });
189	    },
190	  });
191	}
192	
193	// ============================================================================
194	// COMPOSITE HOOKS (for backward compatibility with existing code)
195	// ============================================================================
196	
200	export function useProjects(params: {
201	  page: number;
202	  pageSize: number;
203	  search?: string;
204	  region?: string;
205	  projektleiter?: string;
206	  pruefer?: string;
207	  status?: string;
208	  department?: string;
209	  sortBy?: string;
210	  sortDir?: "asc" | "desc";
211	  showAll?: boolean;
212	}) {
213	  const { data: allProjects, isLoading } = useAllProjects();
214	  const updateProjectMutation = useUpdateProject();
215	  const updateReviewMutation = useUpdateReview();
216	  const createProjectMutation = useCreateProject();
217	
218	  const {
219	    page,
220	    pageSize,
221	    search,
222	    region,
223	    projektleiter,
224	    pruefer,
225	    status,
226	    department,
227	    sortBy = "id",
228	    sortDir = "desc",
229	    showAll = false,
230	  } = params;
231	
232	  const result = useMemo(() => {
233	    if (!allProjects) {
234	      return { projects: [], total: 0, page, pageSize };
235	    }
236	
237	    let filtered = [...allProjects];
238	
239	    // Enhanced Google-like search
240	    if (search) {
241	      const s = search.toLowerCase().trim();
242	      const searchTerms = s.split(/\s+/);
243	      
244	      filtered = filtered.filter((p) => {
245	        // Check if all search terms match at least one field
246	        return searchTerms.every(term => {
247	          return (
248	            p.station?.toLowerCase().includes(term) ||
249	            p.projektbeschreibung?.toLowerCase().includes(term) ||
250	            p.projektnummer?.toLowerCase().includes(term) ||
251	            p.projektleiter?.toLowerCase().includes(term) ||
252	            p.bahnhofsmanagement?.toLowerCase().includes(term) ||
253	            p.kommentar?.toLowerCase().includes(term) ||
254	            p.reviews.some(r => 
255	              r.prueferName?.toLowerCase().includes(term) || 
256	              r.department?.toLowerCase().includes(term) ||
257	              r.status?.toLowerCase().includes(term)
258	            )
259	          );
260	        });
261	      });
262	    }
263	
264	    if (region) filtered = filtered.filter((p) => p.bahnhofsmanagement === region);
265	    if (projektleiter) filtered = filtered.filter((p) => p.projektleiter === projektleiter);
266	    if (pruefer) filtered = filtered.filter((p) => p.reviews.some((r) => r.prueferName === pruefer));
267	    if (department) filtered = filtered.filter((p) => p.reviews.some((r) => r.department === department));
268	
269	    if (status && department) {
270	      filtered = filtered.filter((p) =>
271	        p.reviews.some((r) => r.department === department && r.status === status)
272	      );
273	    } else if (status) {
274	      filtered = filtered.filter((p) => p.reviews.some((r) => r.status === status));
275	    }
276	
277	    if (sortBy) {
278	      filtered.sort((a: Project, b: Project) => {
279	        let va: any = (a as any)[sortBy];
280	        let vb: any = (b as any)[sortBy];
281	        if (va == null && vb == null) return 0;
282	        if (va == null) return sortDir === "asc" ? 1 : -1;
283	        if (vb == null) return sortDir === "asc" ? -1 : 1;
284	        if (typeof va === "string" || typeof vb === "string") {
285	          va = String(va).toLowerCase();
286	          vb = String(vb).toLowerCase();
287	        } else if (typeof va === "number" && typeof vb === "number") {
288	          return sortDir === "asc" ? va - vb : vb - va;
289	        }
290	        if (va < vb) return sortDir === "asc" ? -1 : 1;
291	        if (va > vb) return sortDir === "asc" ? 1 : -1;
292	        return 0;
293	      });
294	    }
295	
296	    const total = filtered.length;
297	    
298	    let projects;
299	    if (showAll) {
300	      projects = filtered;
301	    } else {
302	      const start = (page - 1) * pageSize;
303	      projects = filtered.slice(start, start + pageSize);
304	    }
305	
306	    return { projects, total, page, pageSize, showAll };
307	  }, [allProjects, page, pageSize, search, region, projektleiter, pruefer, status, department, sortBy, sortDir, showAll]);
308	
309	  const applyEdit = useCallback(
310	    (projectId: number, field: string, value: string) => {
311	      updateProjectMutation.mutate({ id: projectId, field: field as any, value });
312	    },
313	    [updateProjectMutation]
314	  );
315	
316	  const applyReviewEdit = useCallback(
317	    (projectId: number, departmentName: string, field: string, value: string) => {
318	      updateReviewMutation.mutate({ projectId, department: departmentName, field: field as any, value });
319	    },
320	    [updateReviewMutation]
321	  );
322	
323	  const addProject = useCallback(
324	    (newProjectData: any) => {
325	      createProjectMutation.mutate(newProjectData);
326	    },
327	    [createProjectMutation]
328	  );
329	
330	  return {
331	    data: result,
332	    isLoading: isLoading || updateProjectMutation.isPending || updateReviewMutation.isPending,
333	    applyEdit,
334	    applyReviewEdit,
335	    addProject,
336	  };
337	}
338	
339	export function useStats() {
340	  const { data, isLoading } = useDashboardStats();
341	  return { data: data ?? null, isLoading };
342	}
343	
344	export function useFilters() {
345	  const { data: allProjects, isLoading } = useAllProjects();
346	
347	  const data: Filters | null = useMemo(() => {
348	    if (!allProjects) return null;
349	    const regions = new Set<string>();
350	    const projektleiter = new Set<string>();
351	    const pruefer = new Set<string>();
352	
353	    allProjects.forEach((p) => {
354	      if (p.bahnhofsmanagement) regions.add(p.bahnhofsmanagement);
355	      if (p.projektleiter) projektleiter.add(p.projektleiter);
356	      p.reviews.forEach((r) => { if (r.prueferName) pruefer.add(r.prueferName); });
357	    });
358	
359	    return {
360	      regions: Array.from(regions).sort(),
361	      projektleiter: Array.from(projektleiter).sort(),
362	      pruefer: Array.from(pruefer).sort(),
363	    };
364	  }, [allProjects]);
365	
366	  return { data, isLoading };
367	}
368	
369	export function useAllData() {
370	  const { data: projects, isLoading: pLoading } = useAllProjects();
371	  const { data: stats, isLoading: sLoading } = useDashboardStats();
372	  const { data: filters, isLoading: fLoading } = useFilters();
373	
374	  const data = useMemo(() => {
375	    if (!projects || !stats || !filters) return null;
376	    return { projects, stats, filters };
377	  }, [projects, stats, filters]);
378	
379	  return { data, isLoading: pLoading || sLoading || fLoading };
380	}
381	
382	export type { Project, Review, Stats, Filters };
383	
