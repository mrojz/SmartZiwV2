import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Safe by default: react-markdown does not render raw HTML, so comment text
// cannot inject markup. Links open in a new tab.
export default function CommentMarkdown({ body = '' }) {
    return (
        <div className="comment-markdown break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ node, ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="font-medium underline" />
                    ),
                }}
            >
                {body}
            </ReactMarkdown>
        </div>
    );
}
