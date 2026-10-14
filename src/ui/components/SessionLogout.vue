<script>
import { browserAuth } from "../auth";

export default {
  props: { toolbar: { type: Boolean, default: false } },
  data() { return { browserAuth }; },
};
</script>

<template>
  <form v-if="browserAuth.enabled && browserAuth.csrf" action="/logout" method="post" :class="{ 'd-inline-block me-2': toolbar }">
    <input type="hidden" name="csrf" :value="browserAuth.csrf" />
    <button type="submit" :class="toolbar ? 'btn btn-outline-light' : 'list-group-item list-group-item-action w-100'">
      <i class="bi bi-box-arrow-right me-1"></i> Sair
    </button>
  </form>
</template>
