Feature: Time limit and absence
  If a human does not react within the time limit, a bot takes over their turn.

  Background:
    Given Anna and Ben play a game in Switzerland with a time limit of 60 seconds

  Scenario: Ben does not react, a bot takes over and Ben counts as absent
    Given Ben has already exceeded the time limit once
    And the dice sequence is 1+2
    And the time runs out for Ben in one second
    Then Anna sees the badge "Abwesend" on Ben
    And Ben sees the badge "Abwesend" on Ben

  Scenario: Ben acts again and no longer counts as absent
    Given Ben has already exceeded the time limit once
    And the dice sequence is 1+2
    And the time runs out for Ben in one second
    And Anna sees the badge "Abwesend" on Ben
    When Ben gives Anna 10
    Then Anna no longer sees the badge "Abwesend" on Ben
