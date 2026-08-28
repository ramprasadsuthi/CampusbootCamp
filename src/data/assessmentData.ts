import { Assessment, CodingProblem, MCQQuestion } from '../types';

export const SAMPLE_CODING_PROBLEMS: Record<string, CodingProblem> = {
  twoSum: {
    id: 'code-1',
    title: 'Two Sum - Target Pair Indices',
    difficulty: 'Easy',
    category: 'Arrays & Hashing',
    description: `Given an array of integers \`nums\` and an integer \`target\`, return the indices of the two numbers such that they add up to \`target\`.

You may assume that each input would have exactly one solution, and you may not use the same element twice. You can return the answer in any order.`,
    constraints: [
      '2 <= nums.length <= 10^4',
      '-10^9 <= nums[i] <= 10^9',
      '-10^9 <= target <= 10^9',
      'Only one valid answer exists.',
    ],
    examples: [
      {
        input: 'nums = [2,7,11,15], target = 9',
        output: '[0,1]',
        explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].',
      },
      {
        input: 'nums = [3,2,4], target = 6',
        output: '[1,2]',
        explanation: 'nums[1] + nums[2] == 6, we return [1, 2].',
      },
    ],
    templates: {
      python: `def twoSum(nums, target):
    # Write your solution here
    seen = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in seen:
            return [seen[diff], i]
        seen[num] = i
    return []`,
      javascript: `function twoSum(nums, target) {
    // Write your solution here
    const map = new Map();
    for (let i = 0; i < nums.length; i++) {
        const complement = target - nums[i];
        if (map.has(complement)) {
            return [map.get(complement), i];
        }
        map.set(nums[i], i);
    }
    return [];
}`,
      java: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        // Write your solution here
        java.util.Map<Integer, Integer> map = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (map.containsKey(complement)) {
                return new int[] { map.get(complement), i };
            }
            map.put(nums[i], i);
        }
        return new int[]{};
    }
}`,
      cpp: `#include <vector>
#include <unordered_map>
using namespace std;

class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> numMap;
        for (int i = 0; i < nums.size(); i++) {
            int complement = target - nums[i];
            if (numMap.find(complement) != numMap.end()) {
                return {numMap[complement], i};
            }
            numMap[nums[i]] = i;
        }
        return {};
    }
};`,
      c: `#include <stdio.h>
#include <stdlib.h>

int* twoSum(int* nums, int numsSize, int target, int* returnSize) {
    *returnSize = 2;
    int* result = (int*)malloc(2 * sizeof(int));
    for (int i = 0; i < numsSize; i++) {
        for (int j = i + 1; j < numsSize; j++) {
            if (nums[i] + nums[j] == target) {
                result[0] = i;
                result[1] = j;
                return result;
            }
        }
    }
    return result;
}`,
    },
    testCases: [
      { input: '[2,7,11,15], target = 9', expected: '[0,1]', hidden: false },
      { input: '[3,2,4], target = 6', expected: '[1,2]', hidden: false },
      { input: '[3,3], target = 6', expected: '[0,1]', hidden: false },
      { input: '[1,5,8,12,19,25], target = 27', expected: '[2,4]', hidden: true },
      { input: '[-3,4,3,90], target = 0', expected: '[0,2]', hidden: true },
    ],
  },
  longestSubstring: {
    id: 'code-2',
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'Medium',
    category: 'Sliding Window',
    description: `Given a string \`s\`, find the length of the **longest substring** without repeating characters.

A substring is a contiguous non-empty sequence of characters within a string.`,
    constraints: [
      '0 <= s.length <= 5 * 10^4',
      's consists of English letters, digits, symbols and spaces.',
    ],
    examples: [
      {
        input: 's = "abcabcbb"',
        output: '3',
        explanation: 'The answer is "abc", with the length of 3.',
      },
      {
        input: 's = "bbbbb"',
        output: '1',
        explanation: 'The answer is "b", with the length of 1.',
      },
      {
        input: 's = "pwwkew"',
        output: '3',
        explanation: 'The answer is "wke", with the length of 3. Note that the answer must be a substring, "pwke" is a subsequence.',
      },
    ],
    templates: {
      python: `def lengthOfLongestSubstring(s: str) -> int:
    # Write your sliding window solution here
    char_map = {}
    left = 0
    max_len = 0
    for right, char in enumerate(s):
        if char in char_map and char_map[char] >= left:
            left = char_map[char] + 1
        char_map[char] = right
        max_len = max(max_len, right - left + 1)
    return max_len`,
      javascript: `function lengthOfLongestSubstring(s) {
    // Write your sliding window solution here
    const map = new Map();
    let left = 0, maxLen = 0;
    for (let right = 0; right < s.length; right++) {
        if (map.has(s[right]) && map.get(s[right]) >= left) {
            left = map.get(s[right]) + 1;
        }
        map.set(s[right], right);
        maxLen = Math.max(maxLen, right - left + 1);
    }
    return maxLen;
}`,
      java: `class Solution {
    public int lengthOfLongestSubstring(String s) {
        java.util.Map<Character, Integer> map = new java.util.HashMap<>();
        int left = 0, maxLen = 0;
        for (int right = 0; right < s.length(); right++) {
            char c = s.charAt(right);
            if (map.containsKey(c) && map.get(c) >= left) {
                left = map.get(c) + 1;
            }
            map.put(c, right);
            maxLen = Math.max(maxLen, right - left + 1);
        }
        return maxLen;
    }
}`,
      cpp: `#include <string>
#include <unordered_map>
#include <algorithm>
using namespace std;

class Solution {
public:
    int lengthOfLongestSubstring(string s) {
        unordered_map<char, int> charMap;
        int left = 0, maxLen = 0;
        for (int right = 0; right < s.size(); right++) {
            if (charMap.find(s[right]) != charMap.end() && charMap[s[right]] >= left) {
                left = charMap[s[right]] + 1;
            }
            charMap[s[right]] = right;
            maxLen = max(maxLen, right - left + 1);
        }
        return maxLen;
    }
};`,
      c: `#include <stdio.h>
#include <string.h>

int lengthOfLongestSubstring(char* s) {
    int n = strlen(s);
    int maxLen = 0, left = 0;
    int lastPos[256];
    for (int i = 0; i < 256; i++) lastPos[i] = -1;
    for (int right = 0; right < n; right++) {
        unsigned char c = s[right];
        if (lastPos[c] >= left) {
            left = lastPos[c] + 1;
        }
        lastPos[c] = right;
        int curLen = right - left + 1;
        if (curLen > maxLen) maxLen = curLen;
    }
    return maxLen;
}`,
    },
    testCases: [
      { input: 's = "abcabcbb"', expected: '3', hidden: false },
      { input: 's = "bbbbb"', expected: '1', hidden: false },
      { input: 's = "pwwkew"', expected: '3', hidden: false },
      { input: 's = "tmmzuxt"', expected: '5', hidden: true },
      { input: 's = "au"', expected: '2', hidden: true },
    ],
  },
  subarraySumK: {
    id: 'code-3',
    title: 'Subarray Sum Equals K',
    difficulty: 'Medium',
    category: 'Prefix Sum & Hashing',
    description: `Given an array of integers \`nums\` and an integer \`k\`, return the total number of subarrays whose sum equals to \`k\`.

A subarray is a contiguous non-empty sequence of elements within an array.`,
    constraints: [
      '1 <= nums.length <= 2 * 10^4',
      '-1000 <= nums[i] <= 1000',
      '-10^7 <= k <= 10^7',
    ],
    examples: [
      {
        input: 'nums = [1,1,1], k = 2',
        output: '2',
        explanation: 'Subarrays [1,1] starting at index 0 and 1.',
      },
      {
        input: 'nums = [1,2,3], k = 3',
        output: '2',
        explanation: 'Subarrays [1,2] and [3].',
      },
    ],
    templates: {
      python: `def subarraySum(nums: list[int], k: int) -> int:
    prefix_map = {0: 1}
    curr_sum = 0
    count = 0
    for num in nums:
        curr_sum += num
        if curr_sum - k in prefix_map:
            count += prefix_map[curr_sum - k]
        prefix_map[curr_sum] = prefix_map.get(curr_sum, 0) + 1
    return count`,
      javascript: `function subarraySum(nums, k) {
    const map = new Map();
    map.set(0, 1);
    let count = 0, sum = 0;
    for (const num of nums) {
        sum += num;
        if (map.has(sum - k)) {
            count += map.get(sum - k);
        }
        map.set(sum, (map.get(sum) || 0) + 1);
    }
    return count;
}`,
      java: `class Solution {
    public int subarraySum(int[] nums, int k) {
        java.util.Map<Integer, Integer> map = new java.util.HashMap<>();
        map.put(0, 1);
        int sum = 0, count = 0;
        for (int num : nums) {
            sum += num;
            if (map.containsKey(sum - k)) {
                count += map.get(sum - k);
            }
            map.put(sum, map.getOrDefault(sum, 0) + 1);
        }
        return count;
    }
}`,
      cpp: `#include <vector>
#include <unordered_map>
using namespace std;

class Solution {
public:
    int subarraySum(vector<int>& nums, int k) {
        unordered_map<int, int> prefixCounts;
        prefixCounts[0] = 1;
        int sum = 0, count = 0;
        for (int num : nums) {
            sum += num;
            if (prefixCounts.find(sum - k) != prefixCounts.end()) {
                count += prefixCounts[sum - k];
            }
            prefixCounts[sum]++;
        }
        return count;
    }
};`,
      c: `#include <stdio.h>

int subarraySum(int* nums, int numsSize, int k) {
    int count = 0;
    for (int i = 0; i < numsSize; i++) {
        int sum = 0;
        for (int j = i; j < numsSize; j++) {
            sum += nums[j];
            if (sum == k) count++;
        }
    }
    return count;
}`,
    },
    testCases: [
      { input: 'nums = [1,1,1], k = 2', expected: '2', hidden: false },
      { input: 'nums = [1,2,3], k = 3', expected: '2', hidden: false },
      { input: 'nums = [1,-1,0], k = 0', expected: '3', hidden: true },
      { input: 'nums = [3,4,7,2,-3,1,4,2], k = 7', expected: '4', hidden: true },
    ],
  },
};

export const ASSESSMENTS_CATALOG: Assessment[] = [
  {
    id: 'assess-day-1',
    dayNumber: 1,
    title: 'Diagnostic Assessment (Batch Profiling)',
    type: 'diagnostic',
    durationMinutes: 180,
    totalMarks: 100,
    coverage: ['Quantitative Aptitude', 'Logical Reasoning', 'Verbal & Communication'],
    purpose: 'Baseline cohort mapping & skill level segmentation for customized 40-day track allocation.',
    status: 'completed',
    scheduledDate: 'Day 1 of 40',
    targetCompanies: ['TCS NQT', 'Infosys', 'Accenture', 'Cognizant', 'Wipro'],
    sections: [
      {
        id: 'sec-diag-apt',
        name: 'Aptitude & Math (20 Questions)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd1-q1',
              section: 'Aptitude',
              text: 'A person crosses a 600 m long street in 5 minutes. What is his speed in km per hour?',
              options: ['3.6 km/hr', '7.2 km/hr', '8.4 km/hr', '10 km/hr'],
              correctIndex: 1,
              explanation: 'Speed = 600m / (5 * 60)s = 2 m/s. In km/hr = 2 * (18/5) = 7.2 km/hr.',
              marks: 2,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd1-q2',
              section: 'Aptitude',
              text: 'If A is 40% less than B, by what percentage is B more than A?',
              options: ['40%', '60%', '66.67%', '50%'],
              correctIndex: 2,
              explanation: 'Let B = 100 => A = 60. B is more than A by (40/60) * 100 = 66.67%.',
              marks: 2,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd1-q3',
              section: 'Aptitude',
              text: 'A train running at 72 km/hr passes a platform 250 m long in 26 seconds. What is the length of the train?',
              options: ['200 m', '270 m', '250 m', '320 m'],
              correctIndex: 1,
              explanation: 'Speed = 72 * 5/18 = 20 m/s. Total distance in 26s = 20 * 26 = 520 m. Train length = 520 - 250 = 270 m.',
              marks: 2,
            },
          },
        ],
      },
      {
        id: 'sec-diag-reasoning',
        name: 'Logical Reasoning (15 Questions)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd1-q4',
              section: 'Reasoning',
              text: 'Pointing to a photograph of a boy, Suresh said, "He is the son of the only son of my mother." How is Suresh related to that boy?',
              options: ['Brother', 'Uncle', 'Cousin', 'Father'],
              correctIndex: 3,
              explanation: 'The only son of Suresh’s mother is Suresh himself. So the boy is Suresh’s son => Suresh is the Father.',
              marks: 2,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd1-q5',
              section: 'Reasoning',
              text: 'In a certain code, MONKEY is written as XDJMNL. How is TIGER written in that code?',
              options: ['SHFDQ', 'HFDSQ', 'RSAFD', 'QDFHS'],
              correctIndex: 3,
              explanation: 'Each letter is decremented by 1 and written in reverse order: T->S, I->H, G->F, E->D, R->Q => Reversed is QDFHS.',
              marks: 2,
            },
          },
        ],
      },
      {
        id: 'sec-diag-comm',
        name: 'Communication & Verbal (15 Questions)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd1-q6',
              section: 'Verbal',
              text: 'Identify the grammatically correct sentence:',
              options: [
                'Neither of the candidates have submitted their resume.',
                'Neither of the candidates has submitted his or her resume.',
                'Neither of the candidate have submitted their resume.',
                'Neither candidate have submitted his resume.',
              ],
              correctIndex: 1,
              explanation: '"Neither" is singular and takes the singular verb "has" and singular pronoun.',
              marks: 2,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-7',
    dayNumber: 7,
    title: 'Coding Benchmark 1',
    type: 'coding_benchmark',
    durationMinutes: 90,
    totalMarks: 100,
    coverage: ['Programming Fundamentals', 'Arrays', 'Strings', 'Sorting', 'Searching', 'Sliding Window'],
    purpose: 'Assessing foundational algorithmic speed, boundary condition handling, and basic complexity management.',
    status: 'completed',
    scheduledDate: 'Day 7 of 40',
    targetCompanies: ['TCS NQT', 'Infosys', 'Accenture', 'Cognizant'],
    sections: [
      {
        id: 'sec-cb1-dsa',
        name: 'Algorithmic Coding (2 Problems)',
        questions: [
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.twoSum },
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.longestSubstring },
        ],
      },
      {
        id: 'sec-cb1-mcq',
        name: 'Time & Space Complexity MCQs',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd7-q1',
              section: 'Complexity',
              text: 'What is the worst-case time complexity of QuickSort when the pivot is always the minimum or maximum element?',
              options: ['O(N log N)', 'O(N)', 'O(N^2)', 'O(log N)'],
              correctIndex: 2,
              explanation: 'When the partition is extremely unbalanced at every step, the recursion depth is N, resulting in O(N^2) total comparisons.',
              marks: 4,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd7-q2',
              section: 'Data Structures',
              text: 'Which data structure is optimal for implementing a sliding window of maximum elements in O(N) overall time?',
              options: ['Max Heap / Priority Queue', 'Monotonic Double-Ended Queue (Deque)', 'Balanced BST', 'Stack'],
              correctIndex: 1,
              explanation: 'A monotonic decreasing deque allows amortized O(1) insertions and deletions at window boundaries, yielding total O(N) runtime.',
              marks: 4,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-14',
    dayNumber: 14,
    title: 'Coding Benchmark 2',
    type: 'coding_benchmark',
    durationMinutes: 90,
    totalMarks: 100,
    coverage: ['Prefix Sum', 'Hashing', 'Recursion', 'Linked List', 'Stack', 'Queue', 'Binary Trees'],
    purpose: 'Evaluating intermediate data structures, recursion call stacks, and pointer management.',
    status: 'completed',
    scheduledDate: 'Day 14 of 40',
    targetCompanies: ['Infosys HackWithInfy', 'TCS Digital', 'Accenture Adv'],
    sections: [
      {
        id: 'sec-cb2-dsa',
        name: 'Core Data Structures Coding',
        questions: [
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.subarraySumK },
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.twoSum },
        ],
      },
      {
        id: 'sec-cb2-trees',
        name: 'Tree & List Conceptual MCQs',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd14-q1',
              section: 'Trees',
              text: 'In a complete binary tree with N nodes, what is the maximum height of the tree?',
              options: ['O(N)', 'O(log N)', 'O(N^2)', 'O(sqrt(N))'],
              correctIndex: 1,
              explanation: 'A complete binary tree fills all levels completely except possibly the last, guaranteeing height h = floor(log2(N)).',
              marks: 5,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd14-q2',
              section: 'Linked Lists',
              text: 'Floyd’s Cycle Detection algorithm uses two pointers moving at speeds 1x and 2x. What is its auxiliary space complexity?',
              options: ['O(N)', 'O(log N)', 'O(1)', 'O(N log N)'],
              correctIndex: 2,
              explanation: 'It only stores two pointer references (slow and fast), maintaining O(1) constant auxiliary memory.',
              marks: 5,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-18',
    dayNumber: 18,
    title: 'Coding Benchmark 3 (BST, SQL Basics & OOP)',
    type: 'coding_benchmark',
    durationMinutes: 120,
    totalMarks: 100,
    coverage: ['Binary Search Trees', 'SQL Basics', 'Object-Oriented Programming (OOP)'],
    purpose: 'Synthesizing data structure trees with database querying and software engineering object principles.',
    status: 'completed',
    scheduledDate: 'Day 18 of 40',
    targetCompanies: ['TCS Digital', 'Capgemini', 'Cognizant Elevate'],
    sections: [
      {
        id: 'sec-cb3-coding',
        name: 'BST & Algorithmic Problem',
        questions: [{ type: 'coding', data: SAMPLE_CODING_PROBLEMS.longestSubstring }],
      },
      {
        id: 'sec-cb3-sql',
        name: 'SQL Query & Schema MCQs',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd18-q1',
              section: 'SQL',
              text: 'Which clause is required to filter aggregated groups computed by GROUP BY?',
              options: ['WHERE', 'HAVING', 'FILTER', 'ORDER BY'],
              correctIndex: 1,
              explanation: 'WHERE filters individual records prior to aggregation; HAVING filters aggregated groups.',
              marks: 4,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd18-q2',
              section: 'OOP',
              text: 'Which OOP pillar is exemplified by declaring private fields and providing public getter and setter methods?',
              options: ['Polymorphism', 'Inheritance', 'Encapsulation', 'Abstraction'],
              correctIndex: 2,
              explanation: 'Encapsulation bundles data and methods together and protects internal state via access control.',
              marks: 4,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-21',
    dayNumber: 21,
    title: 'Aptitude Assessment (Arithmetic & Commercial Math)',
    type: 'aptitude',
    durationMinutes: 60,
    totalMarks: 60,
    coverage: ['Arithmetic', 'Percentages', 'Ratios & Proportions', 'SI & CI', 'Time & Work'],
    purpose: 'Evaluating speed and accuracy in high-frequency commercial quantitative aptitude questions.',
    status: 'completed',
    scheduledDate: 'Day 21 of 40',
    targetCompanies: ['TCS NQT', 'Infosys', 'Capgemini', 'Wipro'],
    sections: [
      {
        id: 'sec-apt-core',
        name: 'Arithmetic Speed & Accuracy',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd21-q1',
              section: 'Time & Work',
              text: 'A can do a piece of work in 12 days and B in 18 days. If they work together for 4 days, what fraction of work is left?',
              options: ['1/3', '4/9', '5/9', '7/18'],
              correctIndex: 1,
              explanation: 'A’s 1 day = 1/12, B’s 1 day = 1/18. Combined 1 day = (3+2)/36 = 5/36. In 4 days = 4 * 5/36 = 20/36 = 5/9. Left = 1 - 5/9 = 4/9.',
              marks: 2,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd21-q2',
              section: 'SI & CI',
              text: 'The difference between simple and compound interest on Rs. 5000 at 10% per annum for 2 years is:',
              options: ['Rs. 50', 'Rs. 45', 'Rs. 60', 'Rs. 25'],
              correctIndex: 0,
              explanation: 'Difference for 2 years = P * (R/100)^2 = 5000 * (10/100)^2 = 5000 * 0.01 = Rs. 50.',
              marks: 2,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-24',
    dayNumber: 24,
    title: 'Reasoning Assessment (Logical Puzzles & Analytical)',
    type: 'reasoning',
    durationMinutes: 60,
    totalMarks: 60,
    coverage: ['Logical Reasoning', 'Seating Arrangement Puzzles', 'Data Sufficiency', 'Analytical Reasoning'],
    purpose: 'Benchmarking analytical deduction and spatial pattern recognition under strict time per question.',
    status: 'completed',
    scheduledDate: 'Day 24 of 40',
    targetCompanies: ['Cognizant', 'Accenture', 'Infosys'],
    sections: [
      {
        id: 'sec-reasoning-core',
        name: 'Analytical & Puzzle Section',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd24-q1',
              section: 'Syllogism',
              text: 'Statements: All pens are books. All books are novels. Conclusions: I. All pens are novels. II. Some novels are pens.',
              options: ['Only I follows', 'Only II follows', 'Both I and II follow', 'Neither follows'],
              correctIndex: 2,
              explanation: 'Pens subset of Books subset of Novels => All pens are novels (I valid) and Some novels are pens (II valid).',
              marks: 2,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-26',
    dayNumber: 26,
    title: 'Full Aptitude Mock Test',
    type: 'aptitude',
    durationMinutes: 90,
    totalMarks: 100,
    coverage: ['Quantitative Aptitude', 'Logical Reasoning', 'Verbal Ability'],
    purpose: 'Full-dress rehearsal of 3-section cognitive screening round of MNC IT companies.',
    status: 'completed',
    scheduledDate: 'Day 26 of 40',
    targetCompanies: ['All Service-Based IT Companies'],
    sections: [
      {
        id: 'sec-fam-quant',
        name: 'Quantitative Aptitude (30 Marks)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd26-q1',
              section: 'Ratios',
              text: 'Two numbers are in the ratio 3:5. If 9 is subtracted from each, the new numbers are in the ratio 12:23. What is the smaller number?',
              options: ['27', '33', '45', '55'],
              correctIndex: 1,
              explanation: '(3x-9)/(5x-9) = 12/23 => 23(3x-9) = 12(5x-9) => 69x - 207 = 60x - 108 => 9x = 99 => x = 11. Smaller number = 3 * 11 = 33.',
              marks: 3,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-30',
    dayNumber: 30,
    title: 'Communication Assessment (Verbal, Resume & HR)',
    type: 'communication',
    durationMinutes: 60,
    totalMarks: 80,
    coverage: ['Grammar', 'Reading Comprehension', 'Resume Defense', 'LinkedIn Branding', 'HR & GD Dynamics'],
    purpose: 'Verifying written and corporate behavioral communication standards.',
    status: 'completed',
    scheduledDate: 'Day 30 of 40',
    targetCompanies: ['TCS NQT', 'Infosys', 'Accenture', 'Cognizant', 'Capgemini'],
    sections: [
      {
        id: 'sec-comm-eval',
        name: 'Grammar & Professional Communication',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd30-q1',
              section: 'Business Communication',
              text: 'In the STAR interview response framework, what does the letter "R" stand for?',
              options: ['Responsibility', 'Result', 'Reaction', 'Resolution'],
              correctIndex: 1,
              explanation: 'STAR stands for Situation, Task, Action, and Result (quantifiable business or technical outcome).',
              marks: 2,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-31',
    dayNumber: 31,
    title: 'Company Coding Challenge (TCS & Infosys Patterns)',
    type: 'coding_benchmark',
    durationMinutes: 120,
    totalMarks: 100,
    coverage: ['Advanced Array Transformations', 'Hash Map Lookups', 'Boundary Test Cases'],
    purpose: 'Simulating official TCS NQT Hands-on and Infosys SP Coding challenge patterns.',
    status: 'completed',
    scheduledDate: 'Day 31 of 40',
    targetCompanies: ['TCS Digital / Prime', 'Infosys SP / DSE'],
    sections: [
      {
        id: 'sec-comp-coding',
        name: 'Hands-on Coding Problems',
        questions: [
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.twoSum },
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.subarraySumK },
        ],
      },
    ],
  },
  {
    id: 'assess-day-33',
    dayNumber: 33,
    title: 'SQL Assessment (Joins, Window Functions & Indexing)',
    type: 'sql',
    durationMinutes: 60,
    totalMarks: 75,
    coverage: ['Relational Joins', 'Window Functions (DENSE_RANK, ROW_NUMBER)', 'GROUP BY & HAVING', 'Indexing'],
    purpose: 'Validating database query writing capabilities required across all service IT drives.',
    status: 'completed',
    scheduledDate: 'Day 33 of 40',
    targetCompanies: ['Accenture', 'Cognizant GenC Next', 'Capgemini'],
    sections: [
      {
        id: 'sec-sql-hands-on',
        name: 'SQL Conceptual & Analytical Questions',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd33-q1',
              section: 'SQL Window Functions',
              text: 'What is the primary difference between RANK() and DENSE_RANK() in SQL when duplicate values occur?',
              options: [
                'RANK() assigns identical ranks without gaps, whereas DENSE_RANK() leaves gaps.',
                'DENSE_RANK() assigns consecutive integers without gaps, whereas RANK() leaves gaps after ties.',
                'RANK() only works with numeric columns.',
                'There is no difference in standard ANSI SQL.',
              ],
              correctIndex: 1,
              explanation: 'If two items tie at rank 1, RANK() assigns the next item rank 3, whereas DENSE_RANK() assigns rank 2 (no gaps).',
              marks: 3,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-35',
    dayNumber: 35,
    title: 'CS Fundamentals Assessment (DBMS, OS, CN, OOP)',
    type: 'technical',
    durationMinutes: 60,
    totalMarks: 80,
    coverage: ['DBMS', 'Operating Systems', 'Computer Networks', 'OOP'],
    purpose: 'Thorough evaluation of core undergraduate engineering principles essential for clearing technical interviews.',
    status: 'completed',
    scheduledDate: 'Day 35 of 40',
    targetCompanies: ['TCS NQT', 'Infosys', 'Accenture', 'Capgemini'],
    sections: [
      {
        id: 'sec-cs-core',
        name: 'Operating Systems & Networks',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd35-q1',
              section: 'Operating Systems',
              text: 'Which of the following is NOT one of the four Coffman conditions necessary for a Deadlock to occur in an OS?',
              options: ['Mutual Exclusion', 'Hold and Wait', 'Preemption Allowed', 'Circular Wait'],
              correctIndex: 2,
              explanation: 'Deadlock requires "No Preemption" (resources cannot be forcibly taken away). "Preemption Allowed" prevents deadlock.',
              marks: 3,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd35-q2',
              section: 'Computer Networks',
              text: 'At which OSI layer does the TCP (Transmission Control Protocol) operate?',
              options: ['Network Layer', 'Transport Layer', 'Data Link Layer', 'Application Layer'],
              correctIndex: 1,
              explanation: 'TCP and UDP are Transport Layer (Layer 4) protocols providing end-to-end communication services.',
              marks: 3,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-36',
    dayNumber: 36,
    title: 'Full Technical Assessment (DSA + SQL + Core CS)',
    type: 'technical',
    durationMinutes: 120,
    totalMarks: 100,
    coverage: ['Data Structures & Algorithms', 'SQL Query Execution', 'Computer Science Core Concepts'],
    purpose: 'Holistic pre-drive technical benchmark combining hands-on coding with system fundamentals.',
    status: 'completed',
    scheduledDate: 'Day 36 of 40',
    targetCompanies: ['TCS Digital', 'Infosys Specialist', 'Accenture FSE'],
    sections: [
      {
        id: 'sec-ft-code',
        name: 'DSA Coding Problems',
        questions: [
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.longestSubstring },
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.subarraySumK },
        ],
      },
    ],
  },
  {
    id: 'assess-day-37',
    dayNumber: 37,
    title: 'Online Placement Drive (Full Corporate Test Simulation)',
    type: 'placement_drive',
    durationMinutes: 150,
    totalMarks: 120,
    coverage: ['Section 1: Cognitive Aptitude', 'Section 2: Advanced Coding (2 Problems)', 'Section 3: Core CS & SQL'],
    purpose: 'Complete live campus placement drive simulation with timer, proctoring emulation, and cross-section scoring.',
    status: 'live',
    scheduledDate: 'Day 37 of 40',
    targetCompanies: ['TCS NQT', 'Infosys', 'Accenture', 'Cognizant', 'Capgemini', 'Wipro'],
    sections: [
      {
        id: 'sec-opd-coding',
        name: 'Section 1: Advanced Hands-on Coding (40 Marks)',
        questions: [
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.twoSum },
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.longestSubstring },
        ],
      },
      {
        id: 'sec-opd-aptitude',
        name: 'Section 2: Cognitive Aptitude & Logical Reasoning (40 Marks)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd37-q1',
              section: 'Aptitude',
              text: 'Two pipes A and B can fill a tank in 20 and 30 minutes respectively. If both are opened together, how long will it take to fill the tank?',
              options: ['12 minutes', '15 minutes', '18 minutes', '25 minutes'],
              correctIndex: 0,
              explanation: '1/20 + 1/30 = (3+2)/60 = 5/60 = 1/12 => 12 minutes to fill.',
              marks: 4,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd37-q2',
              section: 'Reasoning',
              text: 'If SOUTH-EAST becomes NORTH, NORTH-EAST becomes WEST and so on, what will WEST become?',
              options: ['NORTH-EAST', 'SOUTH-EAST', 'SOUTH-WEST', 'NORTH-WEST'],
              correctIndex: 1,
              explanation: 'Each direction turns 135° anti-clockwise. WEST turning 135° anti-clockwise becomes SOUTH-EAST.',
              marks: 4,
            },
          },
        ],
      },
      {
        id: 'sec-opd-cs',
        name: 'Section 3: CS Core & SQL Querying (40 Marks)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd37-q3',
              section: 'DBMS',
              text: 'Which SQL statement is used to remove all rows from a table without logging individual row deletions?',
              options: ['DELETE FROM table;', 'DROP TABLE table;', 'TRUNCATE TABLE table;', 'REMOVE ALL FROM table;'],
              correctIndex: 2,
              explanation: 'TRUNCATE is a DDL operation that deallocates data pages rapidly and cannot be rolled back in standard uncommitted transactions.',
              marks: 4,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'assess-day-40',
    dayNumber: 40,
    title: 'Day 40: Final Placement Assessment & Performance Review',
    type: 'final',
    durationMinutes: 180,
    totalMarks: 150,
    coverage: ['Full 40-Day Curriculum Synthesis', 'Coding Challenge', 'Aptitude Mastery', 'Placement Readiness Dossier'],
    purpose: 'Culmination of the 40-Day Bootcamp, determining final institutional placement readiness certification and Tier 1 shortlist.',
    status: 'live',
    scheduledDate: 'Day 40 of 40 (Capstone Day)',
    targetCompanies: ['TCS (Digital & Ninja)', 'Infosys (Specialist & SE)', 'Accenture (FSE & ASE)', 'Cognizant (Elevate & GenC)', 'Capgemini', 'Wipro Turbo'],
    sections: [
      {
        id: 'sec-final-coding',
        name: 'Part A: Advanced Problem Solving (60 Marks)',
        questions: [
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.twoSum },
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.subarraySumK },
          { type: 'coding', data: SAMPLE_CODING_PROBLEMS.longestSubstring },
        ],
      },
      {
        id: 'sec-final-aptitude',
        name: 'Part B: Speed Cognitive & Analytical Aptitude (45 Marks)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd40-q1',
              section: 'Aptitude',
              text: 'A sum of money invested at compound interest doubles itself in 4 years. In how many years will it become 8 times of itself at the same rate?',
              options: ['8 years', '12 years', '16 years', '24 years'],
              correctIndex: 1,
              explanation: 'In CI: 2^1 times in 4 years. 8 times = 2^3 => 3 * 4 = 12 years.',
              marks: 5,
            },
          },
          {
            type: 'mcq',
            data: {
              id: 'd40-q2',
              section: 'Reasoning',
              text: 'Find the odd one out from the following number series: 2, 5, 10, 17, 26, 37, 50, 64',
              options: ['37', '50', '64', '26'],
              correctIndex: 2,
              explanation: 'Pattern is n^2 + 1: 1^2+1=2, 2^2+1=5, 3^2+1=10, 4^2+1=17, 5^2+1=26, 6^2+1=37, 7^2+1=50, 8^2+1=65 (not 64).',
              marks: 5,
            },
          },
        ],
      },
      {
        id: 'sec-final-core',
        name: 'Part C: Technical Architecture & Core CS (45 Marks)',
        questions: [
          {
            type: 'mcq',
            data: {
              id: 'd40-q3',
              section: 'System Design & CS Core',
              text: 'Which index type is default in relational databases like MySQL InnoDB for primary keys and range queries?',
              options: ['Hash Index', 'B+ Tree Index', 'Bitmap Index', 'R-Tree Index'],
              correctIndex: 1,
              explanation: 'B+ Tree keeps data sorted and balanced, providing O(log N) point search and extremely efficient contiguous range traversals.',
              marks: 5,
            },
          },
        ],
      },
    ],
  },
];
