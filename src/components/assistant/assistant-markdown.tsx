import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const assistantMarkdownComponents: Components = {
  p: ({ children }) => <p className="copilot__md-p">{children}</p>,
  strong: ({ children }) => <strong className="copilot__md-strong">{children}</strong>,
  em: ({ children }) => <em className="copilot__md-em">{children}</em>,
  del: ({ children }) => <del className="copilot__md-del">{children}</del>,
  h1: ({ children }) => <h2 className="copilot__md-h copilot__md-h--1">{children}</h2>,
  h2: ({ children }) => <h3 className="copilot__md-h copilot__md-h--2">{children}</h3>,
  h3: ({ children }) => <h4 className="copilot__md-h copilot__md-h--3">{children}</h4>,
  h4: ({ children }) => <h5 className="copilot__md-h copilot__md-h--4">{children}</h5>,
  ul: ({ children }) => <ul className="copilot__md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="copilot__md-ol">{children}</ol>,
  li: ({ children }) => <li className="copilot__md-li">{children}</li>,
  hr: () => <hr className="copilot__md-hr" />,
  blockquote: ({ children }) => <blockquote className="copilot__md-blockquote">{children}</blockquote>,
  a: ({ children, href }) => (
    <a className="copilot__md-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img className="copilot__md-image" src={src} alt={alt ?? ''} loading="lazy" />
  ),
  code: ({ className, children }) => {
    if (className?.startsWith('language-')) {
      return <code className={`copilot__md-codeblock ${className}`}>{children}</code>;
    }
    return <code className="copilot__md-code">{children}</code>;
  },
  pre: ({ children }) => <pre className="copilot__md-pre">{children}</pre>,
  table: ({ children }) => (
    <div className="copilot__md-table-wrap">
      <table className="copilot__md-table">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="copilot__md-thead">{children}</thead>,
  tbody: ({ children }) => <tbody className="copilot__md-tbody">{children}</tbody>,
  tr: ({ children }) => <tr className="copilot__md-tr">{children}</tr>,
  th: ({ children }) => <th className="copilot__md-th">{children}</th>,
  td: ({ children }) => <td className="copilot__md-td">{children}</td>,
};

export function AssistantMarkdown({ children }: { children: string }): ReactNode {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
      {children}
    </ReactMarkdown>
  );
}
