import type { Todo } from './types';
import styles from './FiberTodo.module.css';

interface TodoItemProps {
  todo: Todo;
  onToggle: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

export function TodoItem({ todo, onToggle, onEdit, onRemove }: TodoItemProps) {
  return (
    <li
      data-todo-id={todo.id}
      className={`fiber-todo-item ${styles.todoItem} ${todo.done ? styles.done : ''} ${
        todo.exiting || todo.hidden ? styles.exiting : ''
      }`}
      aria-hidden={todo.exiting || todo.hidden || undefined}
    >
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={todo.done}
        onChange={() => onToggle(todo.id)}
        aria-label={`切换完成：${todo.text}`}
      />
      <span
        className={styles.todoText}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault(); // 阻止 contentEditable 内部换行
        }}
        onBlur={(e) => {
          const text = e.currentTarget.textContent?.trim();
          if (text && text !== todo.text) onEdit(todo.id, text);
        }}
      >
        {todo.text}
      </span>
      <button
        type="button"
        className={styles.removeBtn}
        onClick={() => onRemove(todo.id)}
        aria-label={`删除：${todo.text}`}
      >
        ✕
      </button>
    </li>
  );
}
