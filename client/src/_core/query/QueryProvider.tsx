/**
 * QueryClientProvider Wrapper
 * 
 * Provides TanStack Query context to entire app
 */

import { QueryClientProvider as TanStackQueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";

export function QueryClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  );
}
