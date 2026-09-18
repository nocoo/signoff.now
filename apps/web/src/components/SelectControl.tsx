import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nocoo/basalt/components/select";
import {
	type AriaAttributes,
	Children,
	isValidElement,
	type ReactNode,
} from "react";

const EMPTY_VALUE = "__signoff_empty__";

type OptionProps = {
	value?: string | number;
	children?: ReactNode;
	disabled?: boolean;
};

export function SelectControl({
	id,
	value,
	onChange,
	children,
	disabled,
	className,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	"aria-required": ariaRequired,
}: {
	id?: string;
	value: string;
	onChange: (value: string) => void;
	children: ReactNode;
	disabled?: boolean;
	className?: string;
	"aria-label"?: string;
	"aria-labelledby"?: AriaAttributes["aria-labelledby"];
	"aria-describedby"?: AriaAttributes["aria-describedby"];
	"aria-invalid"?: AriaAttributes["aria-invalid"];
	"aria-required"?: AriaAttributes["aria-required"];
}) {
	const options = Children.toArray(children).flatMap((child) => {
		if (!isValidElement<OptionProps>(child)) return [];
		const optionValue = String(child.props.value ?? "");
		return [
			{
				value: optionValue,
				label: child.props.children,
				disabled: child.props.disabled,
			},
		];
	});

	return (
		<Select
			value={value === "" ? EMPTY_VALUE : value}
			onValueChange={(next) => onChange(next === EMPTY_VALUE ? "" : next)}
		>
			<SelectTrigger
				id={id}
				disabled={disabled}
				className={className}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				aria-describedby={ariaDescribedBy}
				aria-invalid={ariaInvalid}
				aria-required={ariaRequired}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem
						key={option.value || EMPTY_VALUE}
						value={option.value || EMPTY_VALUE}
						disabled={option.disabled}
					>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
