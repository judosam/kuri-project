import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export interface HeaderContent {
  left?: ReactNode;
  right?: ReactNode;
}

export interface HeaderContextType {
  header: HeaderContent;
  setHeader: (content: HeaderContent) => void;
}

export const HeaderContext = createContext<HeaderContextType>({
  header: {},
  setHeader: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HeaderContent>({});
  return (
    <HeaderContext.Provider value={{ header, setHeader }}>
      {children}
    </HeaderContext.Provider>
  );
}

/** Hook for pages to inject their header content directly into the unified topbar */
export function useTopHeader(
  content: { left?: ReactNode; right?: ReactNode },
  deps: any[] = []
) {
  const { setHeader } = useContext(HeaderContext);

  useEffect(() => {
    setHeader(content);
    return () => {
      setHeader({});
    };
  }, deps);
}
