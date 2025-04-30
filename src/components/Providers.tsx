import React, { ReactNode } from 'react';
import { DockerProvider } from '@/hooks/DockerContext';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <DockerProvider>
      {children}
    </DockerProvider>
  );
} 