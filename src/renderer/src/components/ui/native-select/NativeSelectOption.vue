<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

const props = defineProps<{
  value?: string | number
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <option
    data-slot="native-select-option"
    :value="props.value"
    :disabled="props.disabled"
    :class="cn('bg-popover text-popover-foreground', props.class)"
  >
    <slot />
  </option>
</template>
