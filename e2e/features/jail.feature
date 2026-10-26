Feature: Jail
  Three doubles in a row send you to the dungeon, bail gets you out.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn

  Scenario: Three doubles in a row lead to jail
    Given Anna already owns "Weggisgasse" and "Kramgasse"
    And the dice sequence is 3+3, 4+4, 5+5
    When Anna rolls
    And Anna rolls
    And Anna rolls
    Then Anna is in jail

  Scenario: Anna pays bail and is free
    Given Anna is sitting in jail
    When Anna pays bail
    Then Anna is no longer in jail
    And Anna has a balance of 1'950
