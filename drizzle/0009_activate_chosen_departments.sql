-- Members approved before this change: put them in the departments they chose when registering
UPDATE `department_members` SET `status` = 'active'
WHERE `status` = 'pending' AND `member_id` IN (SELECT `id` FROM `members` WHERE `status` = 'active');
