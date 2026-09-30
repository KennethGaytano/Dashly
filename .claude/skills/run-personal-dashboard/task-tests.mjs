#!/usr/bin/env node
/**
 * Automated Tests for Task Tab Functionality
 * Tests CRUD operations, localStorage persistence, validation, deletion confirmation, and responsive design.
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_SCRIPT = join(__dirname, 'server.mjs');
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}/pages/tasks.html`;

let testCount = 0;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function getExpectedTime(page, timeString) {
  return page.evaluate((value) => {
    const [hours, minutes] = value.split(':').map(Number);
    const date = new Date(2000, 0, 1, hours, minutes);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, timeString);
}

async function runTests() {
  console.log('=== Task Tab Automated Test Suite ===\n');

  // Start server
  const server = spawn('node', [SERVER_SCRIPT], {
    env: { ...process.env, PORT: PORT.toString() },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 1000));

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // -------------------------------------------------------------
    // Test 1: Page Load & Empty State
    // -------------------------------------------------------------
    console.log('--- Test Group 1: Page Load & Initial State ---');
    await page.goto(BASE_URL);

    // Clear localStorage to start clean
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const title = await page.title();
    assert(title.includes('Tasks'), `Page title is correct ("${title}")`);

    const todoEmpty = await page.locator('#todoList .empty-state').textContent();
    assert(todoEmpty.includes('No tasks to do'), 'To Do section shows empty state');

    const inProgressEmpty = await page.locator('#inProgressList .empty-state').textContent();
    assert(inProgressEmpty.includes('No tasks in progress'), 'In Progress section shows empty state');

    const completedEmpty = await page.locator('#completedList .empty-state').textContent();
    assert(completedEmpty.includes('No completed tasks'), 'Completed section shows empty state');

    await page.click('[data-task-filter="all"]');

    // -------------------------------------------------------------
    // Test 2: Form Validation
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: Form Validation ---');
    const titleInput = page.locator('#taskTitle');

    // Check required attribute
    const isRequired = await titleInput.getAttribute('required');
    assert(isRequired !== null, 'Task title input has required attribute');

    // Try submitting empty title via JS
    const submitResult = await page.evaluate(() => {
      const form = document.getElementById('taskForm');
      document.getElementById('taskTitle').value = '';
      const event = new Event('submit', { cancelable: true });
      form.dispatchEvent(event);
      return localStorage.getItem('dashboard_tasks');
    });
    assert(!submitResult || JSON.parse(submitResult).length === 0, 'Empty title does not create a task');

    // -------------------------------------------------------------
    // Test 3: Add Task (To Do, High Priority, Description, Due Date and Time)
    // -------------------------------------------------------------
    /** The add/edit form is collapsed on load. Open it the way a user does. */
    async function openTaskForm() {
      if (await page.locator('#taskTitle').isVisible()) return;
      await page.click('#newTaskBtn');
      await page.waitForSelector('#taskTitle', { state: 'visible' });
    }

    console.log('\n--- Test Group 3: Add Task Functionality ---');
    await openTaskForm();
    await page.fill('#taskTitle', 'Finish Q4 report');
    await page.fill('#taskDescription', 'Compile financial figures and executive summary');

    const dueTimeInput = page.locator('#taskDueTime');
    assert(await dueTimeInput.isDisabled(), 'Due time is disabled until a due date is selected');
    await page.fill('#taskDueDate', '2026-10-15');
    assert(!(await dueTimeInput.isDisabled()), 'Due time is enabled when a due date is selected');
    await dueTimeInput.fill('14:30');
    await page.selectOption('#taskStatus', 'todo');
    await page.selectOption('#taskPriority', 'high');
    await page.click('#submitBtn');

    // Verify task is rendered in To Do list
    await page.waitForSelector('#todoList .task-item');
    const taskTitle = await page.locator('#todoList .task-item .task-text').textContent();
    assert(taskTitle === 'Finish Q4 report', `Task added with title: "${taskTitle}"`);

    const taskDesc = await page.locator('#todoList .task-item .task-description').textContent();
    assert(taskDesc.includes('financial figures'), 'Task description rendered correctly');

    const taskPriority = await page.locator('#todoList .task-item .task-priority').textContent();
    assert(taskPriority === 'high', `Task priority is high`);

    const taskDue = await page.locator('#todoList .task-item .task-due-date').textContent();
    assert(taskDue.includes('Oct 15, 2026'), `Task due date formatted correctly ("${taskDue}")`);

    const taskTime = await page.locator('#todoList .task-item .task-due-time').textContent();
    const expectedTaskTime = await getExpectedTime(page, '14:30');
    assert(taskTime === expectedTaskTime, `Task due time formatted correctly ("${taskTime}")`);

    const storedTask = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('dashboard_tasks')).find(task => task.title === 'Finish Q4 report');
    });
    assert(storedTask.dueDate === '2026-10-15', 'Task due date saved to localStorage');
    assert(storedTask.dueTime === '14:30', 'Task due time saved to localStorage');

    // -------------------------------------------------------------
    // Test 4: Add In Progress & Completed Tasks
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Add Multiple Tasks with Different Statuses ---');
    // Add In Progress task with a date but no time
    await openTaskForm();
    await page.fill('#taskTitle', 'Write Unit Tests');
    await page.fill('#taskDueDate', '2026-10-20');
    await page.selectOption('#taskStatus', 'in_progress');
    await page.selectOption('#taskPriority', 'medium');
    await page.click('#submitBtn');

    await page.waitForSelector('#inProgressList .task-item');
    const inProgressCount = await page.locator('#inProgressList .task-item').count();
    assert(inProgressCount === 1, 'In Progress list has 1 task');
    const dateOnlyDue = await page.locator('#inProgressList .task-item .task-due-date').textContent();
    assert(dateOnlyDue.includes('Oct 20, 2026'), 'Date-only tasks still display their due date');
    assert(await page.locator('#inProgressList .task-item .task-due-time').count() === 0, 'Date-only tasks do not display a due time');

    // Add Completed task
    await openTaskForm();
    await page.fill('#taskTitle', 'Setup Dev Environment');
    await page.selectOption('#taskStatus', 'completed');
    await page.selectOption('#taskPriority', 'low');
    await page.click('#submitBtn');

    // The Completed list lives inside a collapsed <details>, so the item is
    // attached but not visible until the summary is clicked. Wait on
    // 'attached' here and assert the collapsed state separately below.
    await page.waitForSelector('#completedList .task-item', { state: 'attached' });
    const completedCount = await page.locator('#completedList .task-item').count();
    assert(completedCount === 1, 'Completed list has 1 task');
    assert(!(await page.locator('#completedDisclosure').evaluate(el => el.open)), 'Completed tasks start collapsed');
    const storedCompletedTask = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('dashboard_tasks')).find(task => task.title === 'Setup Dev Environment');
    });
    assert(Boolean(storedCompletedTask.completedAt), 'Newly completed tasks record their completion time');

    // -------------------------------------------------------------
    // Test 5: Toggle Status via Checkbox
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Toggle Task Status via Checkbox ---');
    // Toggle the 'Finish Q4 report' task in To Do list -> Should move to Completed
    await page.locator('#todoList .task-item input[type="checkbox"]').click();

    // Check completed count is now 2
    await page.waitForFunction(() => document.querySelectorAll('#completedList .task-item').length === 2);
    const newCompletedCount = await page.locator('#completedList .task-item').count();
    assert(newCompletedCount === 2, 'Toggling checkbox moves task to Completed list');

    // Toggle it back -> Should move to To Do
    await page.locator('#completedDisclosure > summary').click();
    const firstCompletedCheckbox = page.locator('#completedList .task-item input[type="checkbox"]').first();
    await firstCompletedCheckbox.click();

    await page.waitForFunction(() => document.querySelectorAll('#todoList .task-item').length === 1);
    const newTodoCount = await page.locator('#todoList .task-item').count();
    assert(newTodoCount === 1, 'Unchecking task moves it back to To Do list');
    const toggledTask = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('dashboard_tasks')).find(task => task.title === 'Finish Q4 report');
    });
    assert(!toggledTask.completedAt, 'Completion timestamp clears when task is reopened');

    // -------------------------------------------------------------
    // Test 6: Edit Task
    // -------------------------------------------------------------
    console.log('\n--- Test Group 6: Edit Task ---');
    // Click edit on the task in To Do list
    await page.locator('#todoList .task-item .btn-icon[title="Edit"]').click();

    // Verify form is populated
    const editTitleValue = await page.locator('#taskTitle').inputValue();
    assert(editTitleValue.length > 0, `Form populated with title: "${editTitleValue}"`);
    const editDueDateValue = await page.locator('#taskDueDate').inputValue();
    const editDueTimeValue = await page.locator('#taskDueTime').inputValue();
    assert(editDueDateValue === '2026-10-15', `Form populated with due date: "${editDueDateValue}"`);
    assert(editDueTimeValue === '14:30', `Form populated with due time: "${editDueTimeValue}"`);

    const submitBtnText = await page.locator('#submitBtn').textContent();
    assert(submitBtnText.includes('Update'), 'Submit button changes to "Update Task"');

    // Change title, priority, and due time
    // (the edit button already opened the form, so no openTaskForm here)
    await page.fill('#taskTitle', 'Finish Q4 report (REVISED)');
    await page.locator('#taskDueTime').fill('16:45');
    await page.selectOption('#taskPriority', 'low');
    await page.click('#submitBtn');

    // Verify task updated
    const updatedTitle = await page.locator('#todoList .task-item .task-text').textContent();
    assert(updatedTitle === 'Finish Q4 report (REVISED)', `Task title updated to "${updatedTitle}"`);

    const updatedPriority = await page.locator('#todoList .task-item .task-priority').textContent();
    assert(updatedPriority === 'low', 'Task priority updated to "low"');

    const updatedTime = await page.locator('#todoList .task-item .task-due-time').textContent();
    const expectedUpdatedTime = await getExpectedTime(page, '16:45');
    assert(updatedTime === expectedUpdatedTime, `Task due time updated to "${updatedTime}"`);
    const storedEditedTask = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('dashboard_tasks')).find(task => task.title === 'Finish Q4 report (REVISED)');
    });
    assert(storedEditedTask.dueTime === '16:45', 'Updated due time saved to localStorage');

    // -------------------------------------------------------------
    // Test 7: Cancel Edit
    // -------------------------------------------------------------
    console.log('\n--- Test Group 7: Cancel Edit ---');
    await page.locator('#todoList .task-item .btn-icon[title="Edit"]').click();
    assert(await page.locator('#cancelBtn').isVisible(), 'Cancel button is visible during edit');

    await page.click('#cancelBtn');
    const resetBtnText = await page.locator('#submitBtn').textContent();
    assert(resetBtnText.includes('Add Task'), 'Form reset to Add mode after cancel');
    assert(!(await page.locator('#cancelBtn').isVisible()), 'Cancel button is hidden after cancel');
    assert(await page.locator('#taskDueTime').isDisabled(), 'Due time is disabled after resetting an empty due date');
    assert(await page.locator('#taskDueTime').inputValue() === '', 'Due time is cleared after cancelling an edit');

    // -------------------------------------------------------------
    // Test 8: Deletion Confirmation & Deletion
    // -------------------------------------------------------------
    console.log('\n--- Test Group 8: Task Deletion & Confirmation ---');
    // Click delete on In Progress task
    await page.locator('#inProgressList .task-item .btn-icon[title="Delete"]').click();

    // Verify modal appears
    const modalVisible = await page.locator('#confirmModal').isVisible();
    assert(modalVisible, 'Confirmation modal appears on delete click');

    const modalMsg = await page.locator('#confirmMessage').textContent();
    assert(modalMsg.includes('Write Unit Tests'), 'Modal displays correct task title');

    // Cancel deletion first
    await page.click('#cancelModal');
    const modalHidden = !(await page.locator('#confirmModal').isVisible());
    assert(modalHidden, 'Modal closes when clicking Cancel');
    const stillThereCount = await page.locator('#inProgressList .task-item').count();
    assert(stillThereCount === 1, 'Task was not deleted after canceling modal');

    // Now confirm deletion
    await page.locator('#inProgressList .task-item .btn-icon[title="Delete"]').click();
    await page.click('#confirmDelete');

    await page.waitForFunction(() => document.querySelectorAll('#inProgressList .task-item').length === 0);
    const afterDeleteCount = await page.locator('#inProgressList .task-item').count();
    assert(afterDeleteCount === 0, 'Task successfully deleted after confirmation');

    const inProgressNowEmpty = await page.locator('#inProgressList .empty-state').textContent();
    assert(inProgressNowEmpty.includes('No tasks in progress'), 'Empty state restored after deleting last task');

    // -------------------------------------------------------------
    // Test 9: Persistence Across Page Reload
    // -------------------------------------------------------------
    console.log('\n--- Test Group 9: LocalStorage Persistence Across Reload ---');
    // Reload page
    await page.reload();

    const persistedTodo = await page.locator('#todoList .task-item .task-text').textContent();
    assert(persistedTodo === 'Finish Q4 report (REVISED)', `Persisted task loaded after reload: "${persistedTodo}"`);

    const persistedDueTime = await page.locator('#todoList .task-item .task-due-time').textContent();
    const expectedPersistedTime = await getExpectedTime(page, '16:45');
    assert(persistedDueTime === expectedPersistedTime, `Persisted due time loaded after reload: "${persistedDueTime}"`);

    const persistedCompleted = await page.locator('#completedList .task-item .task-text').textContent();
    assert(persistedCompleted === 'Setup Dev Environment', `Persisted completed task loaded: "${persistedCompleted}"`);

    // -------------------------------------------------------------
    // Test 10: Today-First Overview, Filters, and Completion Timestamp
    // -------------------------------------------------------------
    console.log('\n--- Test Group 10: Today-First Task Overview ---');
    const today = await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    const yesterday = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    await page.evaluate(({ todayDate, yesterdayDate }) => {
      const tasks = JSON.parse(localStorage.getItem('dashboard_tasks'));
      tasks.push(
        { id: 'test-due-today', title: 'Due today', status: 'todo', priority: 'low', dueDate: todayDate, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'test-overdue', title: 'Overdue task', status: 'in_progress', priority: 'high', dueDate: yesterdayDate, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      );
      localStorage.setItem('dashboard_tasks', JSON.stringify(tasks));
    }, { todayDate: today, yesterdayDate: yesterday });
    await page.reload();

    const todoTitles = await page.locator('#todoList .task-item .task-text').allTextContents();
    assert(todoTitles[0] === 'Due today', 'Due-today work sorts ahead of later tasks');
    assert(await page.locator('#dueTodayCount').textContent() === '1', 'Today count reflects open tasks due today');
    assert(await page.locator('#overdueCount').textContent() === '1', 'Overdue count reflects overdue open tasks');
    await page.click('[data-task-filter="today"]');
    assert(await page.locator('#todoList .task-item:visible').count() === 1, 'Today filter includes due-today tasks');
    assert(await page.locator('#inProgressList .task-item:visible').count() === 1, 'Today filter also includes overdue in-progress work');
    await page.click('[data-task-filter="overdue"]');
    assert(await page.locator('#todoList .task-item:visible').count() === 0, 'Overdue filter excludes due-today tasks');
    assert(await page.locator('#inProgressList .task-item:visible').count() === 1, 'Overdue filter keeps overdue tasks visible');
    await page.click('[data-task-filter="all"]');
    assert(await page.locator('#todoList .task-item:visible').count() > 1, 'All filter restores the full task list');

    // -------------------------------------------------------------
    // Test 11: XSS Sanitization
    // -------------------------------------------------------------
    console.log('\n--- Test Group 11: Input Sanitization / Security ---');
    await openTaskForm();
    await page.fill('#taskTitle', '<script>alert("xss")</script>Secure Task');
    await page.fill('#taskDescription', '<img src="x" onerror="alert(1)">Description');
    await page.click('#submitBtn');

    // Verify script did not execute, rendered safely
    const xssTask = page.locator('#todoList .task-item').filter({ hasText: 'Secure Task' }).first();
    const xssTitleText = await xssTask.locator('.task-text').innerHTML();
    assert(xssTitleText.includes('&lt;script&gt;'), 'HTML tags sanitized in title');

    // -------------------------------------------------------------
    // Test 11: Malformed stored data must not break the page
    // -------------------------------------------------------------
    console.log('\n--- Test Group 11: Corrupt Storage Recovery ---');

    const errorsDuring = [];
    page.on('pageerror', e => errorsDuring.push(e.message));

    // getTasks() used to trust the parsed shape. An object instead of an array
    // made renderTasks call .filter on a non-array, and a null entry made the
    // status grouping read .status of null. Either one threw an uncaught
    // TypeError and left the page with no task list at all.
    const probe = async (raw, label) => {
      errorsDuring.length = 0;
      await page.evaluate(v => localStorage.setItem('dashboard_tasks', v), raw);
      await page.reload();
      await page.waitForTimeout(400);
      const items = await page.locator('.task-item').count();
      const empties = await page.locator('.empty-state').count();
      assert(errorsDuring.length === 0, `${label}: no uncaught error (${errorsDuring.join('; ') || 'none'})`);
      assert(items + empties > 0, `${label}: the page still renders a task list`);
      return items;
    };

    await probe('{"not":"an array"}', 'object instead of array');
    await probe('[null]', 'array containing null');
    await probe('"just a string"', 'bare string');
    await probe('[1,2,3]', 'array of numbers');
    await probe('{oops', 'unparseable JSON');

    // A task whose status is unrecognised used to match none of the three
    // filters and disappear, which reads as data loss.
    await page.evaluate(() => localStorage.setItem('dashboard_tasks', JSON.stringify([
      { id: 'odd', title: 'Odd status', status: 'banana', priority: 'low', description: '', url: '' },
      { id: 'ok1', title: 'Normal todo', status: 'todo', priority: 'low', description: '', url: '' },
      { id: 'ok2', title: 'Done thing', status: 'completed', priority: 'low', description: '', url: '' }
    ])));
    await page.reload();
    await page.waitForTimeout(400);
    eq(await page.locator('.task-item').count(), 3, 'every stored task is visible');
    eq(await page.locator('#todoList .task-item').count(), 2, 'an unknown status falls into To Do with the open work');
    eq(await page.locator('#completedList .task-item').count(), 1, 'completed stays in Completed');

    // -------------------------------------------------------------
    // Test 12: Mobile Responsiveness
    // -------------------------------------------------------------
    console.log('\n--- Test Group 12: Mobile Viewport Rendering ---');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);

    // The form is collapsed at this point, so open it before measuring it.
    await openTaskForm();
    const isMobileVisible = await page.locator('#taskForm').isVisible();
    assert(isMobileVisible, 'Task form is responsive and visible on mobile viewport');

    function eq(a, b, message) {
      testCount++;
      if (a === b) { passedCount++; console.log(`  ✓ ${message}`); }
      else { failedCount++; console.error(`  ✗ FAIL: ${message} (${a} vs ${b})`); }
    }

    // Clean up
    await browser.close();
  } finally {
    server.kill();
  }

  console.log(`\n=== Test Results: ${passedCount}/${testCount} passed (${failedCount} failed) ===`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
