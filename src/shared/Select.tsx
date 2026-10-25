import {
  Children,
  Fragment,
  isValidElement,
  useId,
  useRef,
  useState,
  type OptionHTMLAttributes,
  type ReactNode,
} from 'react';
import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

interface Option {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

function optionText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return optionText(child.props.children);
      return '';
    })
    .join('');
}

function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return [];
    if (child.type === Fragment) return readOptions(child.props.children);
    if (child.type !== 'option') throw new Error('Select 只接受 option 或 Fragment');
    return [
      {
        value: String(child.props.value ?? optionText(child.props.children)),
        label: child.props.children,
        disabled: Boolean(child.props.disabled),
      },
    ];
  });
}

export interface SelectProps {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  title?: string;
  leadingIcon?: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/** One themed selector for app forms and filters; Radix owns keyboard and popup behavior. */
export function Select({
  value,
  onValueChange,
  children,
  disabled,
  required,
  name,
  id,
  className = '',
  title,
  leadingIcon,
  ...aria
}: SelectProps) {
  const options = readOptions(children);
  const placeholder = options.find((option) => option.value === '')?.label ?? '选择一项';
  const selected = String(value);
  const trigger = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const [invalid, setInvalid] = useState(false);
  return (
    <span
      className="select-wrap"
      onInvalidCapture={(event) => {
        event.preventDefault();
        setInvalid(true);
        trigger.current?.focus();
      }}
    >
      <Primitive.Root
        value={selected}
        onValueChange={(next) => {
          setInvalid(false);
          onValueChange(next);
        }}
        disabled={disabled || options.every((option) => option.disabled || option.value === '')}
        required={required}
        name={name}
      >
        <Primitive.Trigger
          {...aria}
          ref={trigger}
          id={id}
          title={
            title ??
            optionText(options.find((option) => option.value === selected)?.label ?? placeholder)
          }
          className={`select-trigger ${className}`}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [aria['aria-describedby'], invalid ? errorId : ''].filter(Boolean).join(' ') ||
            undefined
          }
        >
          {leadingIcon && (
            <span className="select-leading" aria-hidden="true">
              {leadingIcon}
            </span>
          )}
          <span className="select-value">
            <Primitive.Value placeholder={placeholder} />
          </span>
          <Primitive.Icon className="select-chevron">
            <ChevronDown size={18} strokeWidth={1.65} />
          </Primitive.Icon>
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            className="select-content"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
            hideWhenDetached
          >
            <Primitive.ScrollUpButton className="select-scroll">
              <ChevronUp size={18} strokeWidth={1.65} />
            </Primitive.ScrollUpButton>
            <Primitive.Viewport className="select-viewport">
              {options
                .filter((option) => option.value !== '')
                .map((option) => (
                  <Primitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    textValue={optionText(option.label)}
                    className="select-item"
                  >
                    <Primitive.ItemText>{option.label}</Primitive.ItemText>
                    <Primitive.ItemIndicator className="select-check">
                      <Check size={18} strokeWidth={1.65} />
                    </Primitive.ItemIndicator>
                  </Primitive.Item>
                ))}
            </Primitive.Viewport>
            <Primitive.ScrollDownButton className="select-scroll">
              <ChevronDown size={18} strokeWidth={1.65} />
            </Primitive.ScrollDownButton>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
      {invalid && (
        <span id={errorId} className="control-error" role="alert">
          请选择一项
        </span>
      )}
    </span>
  );
}
